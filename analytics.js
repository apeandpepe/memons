/**
 * Vercel Web Analytics initialization
 * This file injects the Vercel Web Analytics tracking script.
 * Learn more: https://vercel.com/docs/analytics
 */

// Import and inject analytics from the local copy of @vercel/analytics
import { inject } from './vercel-analytics.js';

// Initialize analytics
inject({
  mode: 'auto', // auto-detect production vs development
  debug: false   // set to true to see debug logs in development
});
