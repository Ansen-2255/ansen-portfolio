/** @type {import('tailwindcss').Config} */
export default {
  // This tells Tailwind to scan the main React file for utility classes
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Define the custom font we used
      fontFamily: {
        inter: ['Inter', 'sans-serif'],
      },
      // You can define custom colors here if needed
      colors: {
        'cyan': {
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2',
          900: '#0f172a',
        },
        'gray': {
          400: '#9ca3af',
          500: '#6b7280',
          700: '#374151',
          800: '#1f2937',
          900: '#111827',
          950: '#030712',
        }
      }
    },
  },
  plugins: [],
}
