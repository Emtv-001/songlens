require('dotenv').config();
const mongoose = require('mongoose');
const Song = require('../models/Song');

const hymns = [
  {
    title: 'Amazing Grace',
    artist: 'John Newton (1779)',
    description: 'Classic hymn about redemption and grace.',
  },
  {
    title: 'Abide with Me',
    artist: 'Henry Francis Lyte (1847)',
    description: 'Evening hymn of trust and comfort.',
  },
  {
    title: 'Holy, Holy, Holy',
    artist: 'Reginald Heber (1826)',
    description: 'Hymn of praise to the Trinity.',
  },
  {
    title: 'Rock of Ages',
    artist: 'Augustus Toplady (1763)',
    description: 'Hymn of refuge and faith.',
  },
  {
    title: 'Come, Thou Fount of Every Blessing',
    artist: 'Robert Robinson (1758)',
    description: 'Hymn of gratitude and devotion.',
  },
];

async function seed() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is missing. Check your .env file.');
  }

  await mongoose.connect(process.env.MONGODB_URI);

  for (const hymn of hymns) {
    await Song.updateOne(
      { title: hymn.title, sourceType: 'public_domain' },
      {
        $set: { ...hymn, visibility: 'public' },
        $setOnInsert: { sourceType: 'public_domain', ownerId: null },
      },
      { upsert: true }
    );
  }

  console.log(`Seeded ${hymns.length} public-domain hymns.`);
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});