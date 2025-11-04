/**
 * TensorFlow.js Neural Network for Staff Size Prediction
 * 
 * This model predicts the optimal number of staff members needed for an event
 * based on historical event data and sales metrics.
 */

// TensorFlow.js will be imported dynamically to avoid SSR issues
let tf: any = null;

interface TrainingDataPoint {
  ticketSales: number;
  ticketCount: number;
  venue: string;
  durationHours: number;
  hasArtist: number; // 0 or 1
  actualTeamSize: number;
}

interface PredictionInput {
  ticketSales: number;
  ticketCount: number;
  venue: string;
  startTime?: string | null;
  endTime?: string | null;
  artist?: string | null;
}

interface ModelStats {
  minTicketSales: number;
  maxTicketSales: number;
  minTicketCount: number;
  maxTicketCount: number;
  minDuration: number;
  maxDuration: number;
  venueList: string[];
}

interface TrainingResult {
  model: any;
  venueEncoder: Map<string, number>;
  stats: ModelStats;
}

let cachedModel: any = null;
let cachedVenueEncoder: Map<string, number> = new Map();
let cachedStats: ModelStats | null = null;

/**
 * Dynamically import TensorFlow.js
 */
async function loadTensorFlow() {
  if (!tf) {
    // Use @tensorflow/tfjs (works in both Node.js and browser)
    // For better performance on server, @tensorflow/tfjs-node can be used if available
    try {
      // Try tfjs-node first for better performance (optional)
      const tfNode = await import('@tensorflow/tfjs-node');
      tf = tfNode.default;
      console.log('[ML] Using @tensorflow/tfjs-node (optimized)');
    } catch (error) {
      // Fallback to regular tfjs (works everywhere)
      const tfJs = await import('@tensorflow/tfjs');
      tf = tfJs.default;
      console.log('[ML] Using @tensorflow/tfjs (standard)');
    }
  }
  return tf;
}

/**
 * Normalize a value to [0, 1] range
 */
function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/**
 * Denormalize a value from [0, 1] back to original range
 */
function denormalize(value: number, min: number, max: number): number {
  return value * (max - min) + min;
}

/**
 * Encode venue as one-hot vector
 */
function encodeVenue(venue: string, venueEncoder: Map<string, number>, venueList: string[]): number[] {
  const venueIndex = venueEncoder.get(venue) ?? venueList.length - 1; // Default to last (unknown)
  return venueList.map((_, i) => i === venueIndex ? 1 : 0);
}

/**
 * Calculate event duration from start/end times
 */
function calculateDuration(startTime: string | null | undefined, endTime: string | null | undefined): number {
  if (!startTime || !endTime) return 4; // Default 4 hours
  
  try {
    const start = new Date(`2000-01-01T${startTime}`);
    const end = new Date(`2000-01-01T${endTime}`);
    const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    return Math.max(1, Math.min(24, hours)); // Clamp between 1-24 hours
  } catch {
    return 4;
  }
}

/**
 * Prepare training data and extract statistics
 */
function prepareTrainingData(data: TrainingDataPoint[]): {
  features: number[][];
  labels: number[];
  stats: ModelStats;
  venueEncoder: Map<string, number>;
} {
  if (data.length === 0) {
    throw new Error('No training data provided');
  }

  // Extract unique venues
  const venues = [...new Set(data.map(d => d.venue))];
  const venueEncoder = new Map<string, number>();
  venues.forEach((venue, idx) => venueEncoder.set(venue, idx));

  // Calculate statistics for normalization
  const ticketSales = data.map(d => d.ticketSales);
  const ticketCounts = data.map(d => d.ticketCount);
  const durations = data.map(d => d.durationHours);

  const stats: ModelStats = {
    minTicketSales: Math.min(...ticketSales),
    maxTicketSales: Math.max(...ticketSales),
    minTicketCount: Math.min(...ticketCounts),
    maxTicketCount: Math.max(...ticketCounts),
    minDuration: Math.min(...durations),
    maxDuration: Math.max(...durations),
    venueList: venues,
  };

  // Prepare features: [normalizedTicketSales, normalizedTicketCount, normalizedDuration, hasArtist, ...venueOneHot]
  const features: number[][] = [];
  const labels: number[] = [];

  for (const point of data) {
    const normalizedSales = normalize(point.ticketSales, stats.minTicketSales, stats.maxTicketSales);
    const normalizedCount = normalize(point.ticketCount, stats.minTicketCount, stats.maxTicketCount);
    const normalizedDuration = normalize(point.durationHours, stats.minDuration, stats.maxDuration);
    const venueOneHot = encodeVenue(point.venue, venueEncoder, venues);

    features.push([
      normalizedSales,
      normalizedCount,
      normalizedDuration,
      point.hasArtist,
      ...venueOneHot,
    ]);
    labels.push(point.actualTeamSize);
  }

  return { features, labels, stats, venueEncoder };
}

/**
 * Create and compile neural network model
 */
async function createModel(inputSize: number): Promise<any> {
  const tfInstance = await loadTensorFlow();
  
  const model = tfInstance.sequential({
    layers: [
      // Input layer
      tfInstance.layers.dense({
        inputShape: [inputSize],
        units: 32,
        activation: 'relu',
        name: 'hidden1',
      }),
      // Hidden layer 1
      tfInstance.layers.dense({
        units: 24,
        activation: 'relu',
        name: 'hidden2',
      }),
      // Dropout for regularization
      tfInstance.layers.dropout({
        rate: 0.2,
        name: 'dropout1',
      }),
      // Hidden layer 2
      tfInstance.layers.dense({
        units: 16,
        activation: 'relu',
        name: 'hidden3',
      }),
      // Output layer (single value: predicted staff count)
      tfInstance.layers.dense({
        units: 1,
        activation: 'linear',
        name: 'output',
      }),
    ],
  });

  // Compile model
  model.compile({
    optimizer: tfInstance.train.adam(0.001),
    loss: 'meanSquaredError',
    metrics: ['meanAbsoluteError'],
  });

  return model;
}

/**
 * Train the neural network model
 */
export async function trainModel(trainingData: TrainingDataPoint[]): Promise<TrainingResult> {
  if (trainingData.length < 5) {
    throw new Error('Need at least 5 data points to train the model');
  }

  const tfInstance = await loadTensorFlow();

  // Prepare data
  const { features, labels, stats, venueEncoder } = prepareTrainingData(trainingData);

  // Create model
  const inputSize = features[0].length;
  const model = await createModel(inputSize);

  // Convert to tensors
  const xs = tfInstance.tensor2d(features);
  const ys = tfInstance.tensor2d(labels, [labels.length, 1]);

  // Train model
  const epochs = 100;
  const batchSize = Math.min(32, Math.floor(trainingData.length / 2));

  console.log(`[ML] Training model with ${trainingData.length} samples, ${epochs} epochs, batch size ${batchSize}`);

  await model.fit(xs, ys, {
    epochs,
    batchSize,
    validationSplit: 0.2,
    shuffle: true,
    verbose: 0, // Set to 1 for training progress
    callbacks: {
      onEpochEnd: (epoch: number, logs: any) => {
        if (epoch % 20 === 0) {
          console.log(`[ML] Epoch ${epoch + 1}/${epochs} - loss: ${logs.loss?.toFixed(4)}`);
        }
      },
    },
  });

  // Clean up tensors
  xs.dispose();
  ys.dispose();

  // Cache the model
  cachedModel = model;
  cachedVenueEncoder = venueEncoder;
  cachedStats = stats;

  console.log('[ML] Model training completed');

  return {
    model,
    venueEncoder,
    stats,
  };
}

/**
 * Make prediction using trained model
 */
export async function predict(
  input: PredictionInput,
  model?: any,
  venueEncoder?: Map<string, number>,
  stats?: ModelStats
): Promise<number> {
  await loadTensorFlow();

  const useModel = model || cachedModel;
  const useVenueEncoder = venueEncoder || cachedVenueEncoder;
  const useStats = stats || cachedStats;

  if (!useModel || !useStats || useVenueEncoder.size === 0) {
    throw new Error('Model not trained. Call trainModel() first.');
  }

  // Prepare input features
  const durationHours = calculateDuration(input.startTime, input.endTime);
  const hasArtist = input.artist ? 1 : 0;

  const normalizedSales = normalize(input.ticketSales, useStats.minTicketSales, useStats.maxTicketSales);
  const normalizedCount = normalize(input.ticketCount, useStats.minTicketCount, useStats.maxTicketCount);
  const normalizedDuration = normalize(durationHours, useStats.minDuration, useStats.maxDuration);
  const venueOneHot = encodeVenue(input.venue, useVenueEncoder, useStats.venueList);

  const features = [
    normalizedSales,
    normalizedCount,
    normalizedDuration,
    hasArtist,
    ...venueOneHot,
  ];

  const tfInstance = await loadTensorFlow();

  // Make prediction
  const inputTensor = tfInstance.tensor2d([features]);
  const prediction = useModel.predict(inputTensor) as any;
  const predictedValue = await prediction.data();
  
  // Clean up
  inputTensor.dispose();
  prediction.dispose();

  // Denormalize and round (staff count should be integer)
  const predictedStaff = Math.max(2, Math.round(predictedValue[0]));

  return predictedStaff;
}

/**
 * Dispose of cached model to free memory
 */
export function disposeModel(): void {
  if (cachedModel) {
    cachedModel.dispose();
    cachedModel = null;
  }
  cachedVenueEncoder.clear();
  cachedStats = null;
}

/**
 * Get model summary/info
 */
export function getModelInfo(): {
  hasModel: boolean;
  stats: ModelStats | null;
  venueCount: number;
} {
  return {
    hasModel: cachedModel !== null,
    stats: cachedStats,
    venueCount: cachedVenueEncoder.size,
  };
}

