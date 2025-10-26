/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Webpack optimization for PDF libraries
  webpack: (config, { isServer }) => {
    // Optimize PDF library bundling
    config.externals = config.externals || [];

    if (!isServer) {
      // Make sure PDF libraries are only loaded client-side
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
    }

    // Reduce memory usage during build
    config.optimization = {
      ...config.optimization,
      splitChunks: {
        chunks: 'all',
        cacheGroups: {
          pdf: {
            test: /[\\/]node_modules[\\/](pdf-lib|pdfjs-dist|react-pdf)[\\/]/,
            name: 'pdf-libraries',
            priority: 10,
          },
        },
      },
    };

    return config;
  },

  // Security headers for SOC2 compliance
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on'
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload'
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block'
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin'
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(self), interest-cohort=()'
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              "connect-src 'self' https://*.supabase.co https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
              "worker-src 'self' blob: https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; ')
          }
        ]
      }
    ];
  },
  
  // Environment variable validation
  env: {
    NEXT_PUBLIC_APP_NAME: 'PDS Time Tracking System',
  },
};

module.exports = nextConfig;

