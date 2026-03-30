import Redis from 'redis';

const redisClient = Redis.createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
});

redisClient.on('error', (err) => {
  console.error('[Redis] Error:', err);
});

redisClient.on('connect', () => {
  console.log('[Redis] Connected');
});

redisClient.on('ready', () => {
  console.log('[Redis] Ready');
});

export default redisClient;
