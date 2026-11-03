export async function closeResources(server, pool) {
  try {
    if (server?.listening) {
      // Stop new requests and finish active requests before ending the pool.
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  } finally {
    await pool.end();
  }
}
