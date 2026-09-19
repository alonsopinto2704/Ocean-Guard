import app from '../server';

// Vercel invokes the Express application as a serverless function. The local
// and Docker entry point in server.ts continues to listen on port 3000.
export default app;

export const config = {
  api: {
    bodyParser: false,
  },
};
