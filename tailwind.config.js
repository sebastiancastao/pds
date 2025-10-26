/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Apple 2025 Liquid Glass Primary Palette
        liquid: {
          blue: {
            50: 'rgba(240, 249, 255, 0.85)',
            100: 'rgba(224, 242, 254, 0.85)',
            200: 'rgba(186, 230, 253, 0.85)',
            300: 'rgba(125, 211, 252, 0.85)',
            400: 'rgba(56, 189, 248, 0.85)',
            500: 'rgba(14, 165, 233, 0.85)',
            600: 'rgba(2, 132, 199, 0.85)',
            700: 'rgba(3, 105, 161, 0.85)',
            800: 'rgba(7, 89, 133, 0.85)',
            900: 'rgba(12, 74, 110, 0.85)',
          },
          purple: {
            50: 'rgba(250, 245, 255, 0.85)',
            100: 'rgba(243, 232, 255, 0.85)',
            200: 'rgba(233, 213, 255, 0.85)',
            300: 'rgba(216, 180, 254, 0.85)',
            400: 'rgba(192, 132, 252, 0.85)',
            500: 'rgba(168, 85, 247, 0.85)',
            600: 'rgba(147, 51, 234, 0.85)',
            700: 'rgba(126, 34, 206, 0.85)',
            800: 'rgba(107, 33, 168, 0.85)',
            900: 'rgba(88, 28, 135, 0.85)',
          },
          glass: {
            white: 'rgba(255, 255, 255, 0.7)',
            lighter: 'rgba(255, 255, 255, 0.85)',
            light: 'rgba(255, 255, 255, 0.6)',
            medium: 'rgba(255, 255, 255, 0.4)',
            dark: 'rgba(0, 0, 0, 0.05)',
          },
        },
        // iOS System Colors
        ios: {
          blue: '#007AFF',
          indigo: '#5856D6',
          purple: '#AF52DE',
          pink: '#FF2D55',
          red: '#FF3B30',
          orange: '#FF9500',
          yellow: '#FFCC00',
          green: '#34C759',
          teal: '#5AC8FA',
          gray: '#8E8E93',
        },
      },
      backgroundImage: {
        'liquid-gradient': 'linear-gradient(135deg, rgba(240, 249, 255, 0.95) 0%, rgba(224, 242, 254, 0.95) 50%, rgba(186, 230, 253, 0.95) 100%)',
        'liquid-purple': 'linear-gradient(135deg, rgba(250, 245, 255, 0.95) 0%, rgba(233, 213, 255, 0.95) 50%, rgba(216, 180, 254, 0.95) 100%)',
        'liquid-mesh': 'radial-gradient(at 40% 20%, rgba(56, 189, 248, 0.2) 0px, transparent 50%), radial-gradient(at 80% 0%, rgba(168, 85, 247, 0.2) 0px, transparent 50%), radial-gradient(at 0% 50%, rgba(14, 165, 233, 0.2) 0px, transparent 50%), radial-gradient(at 80% 50%, rgba(56, 189, 248, 0.15) 0px, transparent 50%), radial-gradient(at 0% 100%, rgba(192, 132, 252, 0.2) 0px, transparent 50%), radial-gradient(at 80% 100%, rgba(14, 165, 233, 0.2) 0px, transparent 50%)',
      },
      backdropBlur: {
        'xs': '2px',
        'liquid': '24px',
        'liquid-strong': '40px',
      },
      boxShadow: {
        'liquid-sm': '0 2px 16px -2px rgba(0, 0, 0, 0.06), 0 1px 4px -1px rgba(0, 0, 0, 0.04)',
        'liquid': '0 4px 24px -4px rgba(0, 0, 0, 0.08), 0 2px 8px -2px rgba(0, 0, 0, 0.05)',
        'liquid-lg': '0 8px 32px -6px rgba(0, 0, 0, 0.1), 0 4px 12px -3px rgba(0, 0, 0, 0.06)',
        'liquid-xl': '0 20px 60px -12px rgba(0, 0, 0, 0.12), 0 8px 24px -6px rgba(0, 0, 0, 0.08)',
        'liquid-glow': '0 0 20px rgba(14, 165, 233, 0.3), 0 0 40px rgba(56, 189, 248, 0.2)',
        'liquid-glow-purple': '0 0 20px rgba(168, 85, 247, 0.3), 0 0 40px rgba(192, 132, 252, 0.2)',
      },
      borderRadius: {
        'liquid': '1.25rem',
        'liquid-lg': '1.75rem',
        'liquid-xl': '2rem',
      },
      animation: {
        'float': 'float 6s ease-in-out infinite',
        'glow': 'glow 3s ease-in-out infinite',
        'shimmer': 'shimmer 2.5s linear infinite',
        'slide-up': 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-down': 'slideDown 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-in': 'fadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-in': 'scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        glow: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      letterSpacing: {
        'apple': '-0.01em',
        'apple-tight': '-0.02em',
      },
    },
  },
  plugins: [],
}

