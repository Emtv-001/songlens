require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/db');
const analysisWorker = require('./jobs/analysisWorker');

const PORT = process.env.PORT || 5000;

async function start() {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(`SongLens server running on port ${PORT}`);
    });
    analysisWorker.start();
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

start();