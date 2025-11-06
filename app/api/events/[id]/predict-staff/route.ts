import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { trainModel, predict, disposeModel } from '@/lib/staff-prediction-model';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Cache for trained model (in production, consider using Redis or file storage)
let modelCache: {
  model: any;
  venueEncoder: Map<string, number>;
  stats: any;
  lastTrained: Date;
  historicalDataHash: string;
} | null = null;

/**
 * Fallback prediction when no historical data or model training fails
 */
function fallbackPrediction(event: any): number {
  const baseStaff = 3;
  const ticketFactor = Math.ceil((event.ticket_count || 0) / 100);
  const salesFactor = event.ticket_sales ? Math.ceil(event.ticket_sales / 5000) : 0;
  return Math.max(baseStaff, Math.max(ticketFactor, salesFactor));
}

/**
 * Hash historical data to detect changes
 */
function hashHistoricalData(data: any[]): string {
  return data.map(d => `${d.ticket_sales}-${d.ticket_count}-${d.venue}-${d.actual_team_size}`).join('|');
}

/**
 * Calculate event duration from start/end times
 */
function calculateDuration(startTime: string | null | undefined, endTime: string | null | undefined): number {
  if (!startTime || !endTime) return 4;
  
  try {
    const start = new Date(`2000-01-01T${startTime}`);
    const end = new Date(`2000-01-01T${endTime}`);
    const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    return Math.max(1, Math.min(24, hours));
  } catch {
    return 4;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    let { data: { user } } = await supabase.auth.getUser();

    // Fallback to Authorization header
    if (!user || !user.id) {
      const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
      const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: tokenUser } = await supabaseAnon.auth.getUser(token);
        if (tokenUser?.user?.id) {
          user = { id: tokenUser.user.id } as any;
        }
      }
    }

    if (!user || !user.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const eventId = params.id;
    if (!eventId) {
      return NextResponse.json({ error: "Event ID is required" }, { status: 400 });
    }

    // Get current event
    const { data: event, error: eventError } = await supabaseAdmin
      .from("events")
      .select("*")
      .eq("id", eventId)
      .single();

    if (eventError || !event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Get historical event data with actual team sizes
    const { data: historicalEvents, error: histError } = await supabaseAdmin
      .from("events")
      .select(`
        id,
        ticket_sales,
        ticket_count,
        venue,
        start_time,
        end_time,
        artist
      `)
      .not("ticket_count", "is", null)
      .neq("id", eventId); // Exclude current event

    if (histError) {
      console.error("[PREDICT] Error fetching historical data:", histError);
    }

    // Get actual team sizes for historical events
    const historicalData = [];
    if (historicalEvents && historicalEvents.length > 0) {
      for (const histEvent of historicalEvents) {
        const { count } = await supabaseAdmin
          .from("event_teams")
          .select("*", { count: "exact", head: true })
          .eq("event_id", histEvent.id);

        if (count !== null && count > 0) {
          // Calculate duration
          const durationHours = calculateDuration(histEvent.start_time, histEvent.end_time);
          
          historicalData.push({
            ticket_sales: histEvent.ticket_sales || 0,
            ticket_count: histEvent.ticket_count || 0,
            venue: histEvent.venue,
            durationHours,
            hasArtist: histEvent.artist ? 1 : 0,
            actual_team_size: count,
          });
        }
      }
    }

    let predictedStaff: number;
    let confidence: number;
    let modelType = "fallback";

    // Use TensorFlow.js neural network if we have enough data
    if (historicalData.length >= 5) {
      try {
        const dataHash = hashHistoricalData(historicalData);
        
        // Check if we need to retrain (cache miss or data changed)
        const needsRetraining = !modelCache || 
          modelCache.historicalDataHash !== dataHash ||
          (Date.now() - modelCache.lastTrained.getTime()) > 24 * 60 * 60 * 1000; // Retrain daily

        if (needsRetraining) {
          console.log('[PREDICT] Training TensorFlow.js model with', historicalData.length, 'data points');
          
          // Dispose old model if exists
          if (modelCache?.model) {
            disposeModel();
          }

          // Prepare training data
          const trainingData = historicalData.map(d => ({
            ticketSales: d.ticket_sales,
            ticketCount: d.ticket_count,
            venue: d.venue,
            durationHours: d.durationHours,
            hasArtist: d.hasArtist,
            actualTeamSize: d.actual_team_size,
          }));

          // Train model
          const trainingResult = await trainModel(trainingData);
          
          // Cache the model
          modelCache = {
            model: trainingResult.model,
            venueEncoder: trainingResult.venueEncoder,
            stats: trainingResult.stats,
            lastTrained: new Date(),
            historicalDataHash: dataHash,
          };

          console.log('[PREDICT] Model trained successfully');
        }

        // Ensure modelCache is initialized (TypeScript narrowing for non-null)
        const cache = modelCache;
        if (!cache) {
          throw new Error('Model cache not initialized after training check');
        }

        // Make prediction using TensorFlow.js model
        predictedStaff = await predict(
          {
            ticketSales: event.ticket_sales || 0,
            ticketCount: event.ticket_count || 0,
            venue: event.venue,
            startTime: event.start_time,
            endTime: event.end_time,
            artist: event.artist,
          },
          cache.model,
          cache.venueEncoder,
          cache.stats
        );

        modelType = "tensorflow-neural-network";
        
        // Calculate confidence based on data quality and model training
        const baseConfidence = historicalData.length > 20 ? 0.90 : 
                              historicalData.length > 10 ? 0.85 : 
                              historicalData.length > 5 ? 0.75 : 0.65;
        
        // Adjust confidence based on venue similarity
        const venueMatches = historicalData.filter(d => d.venue === event.venue).length;
        const venueConfidenceBoost = venueMatches > 0 ? Math.min(0.1, venueMatches / historicalData.length * 0.2) : 0;
        
        confidence = Math.min(0.95, baseConfidence + venueConfidenceBoost);
        
      } catch (modelError: any) {
        console.error('[PREDICT] TensorFlow.js model error:', modelError);
        // Fallback to heuristic if model fails
        predictedStaff = fallbackPrediction(event);
        confidence = 0.50;
        modelType = "fallback-heuristic";
      }
    } else {
      // Not enough data for neural network, use fallback
      predictedStaff = fallbackPrediction(event);
      confidence = historicalData.length > 0 ? 0.50 : 0.30;
      modelType = "fallback-heuristic";
    }

    return NextResponse.json({
      success: true,
      predictedStaff,
      confidence,
      historicalDataPoints: historicalData.length,
      model: modelType,
      features: {
        ticketCount: event.ticket_count || 0,
        ticketSales: event.ticket_sales || 0,
        venue: event.venue,
        hasArtist: !!event.artist,
      },
    });
  } catch (error: any) {
    console.error("[PREDICT] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to predict staff size" },
      { status: 500 }
    );
  }
}
