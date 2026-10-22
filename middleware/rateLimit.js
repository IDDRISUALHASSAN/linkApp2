const createRateLimiter = (windowMs, max) => {
  const store = new Map();

  const cleanup = () => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now - entry.start > windowMs) store.delete(key);
    }
  };

  setInterval(cleanup, windowMs).unref();

  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    let entry = store.get(key);

    if (!entry || now - entry.start > windowMs) {
      entry = { count: 0, start: now };
      store.set(key, entry);
    }

    entry.count += 1;

    if (entry.count > max) {
      return res.status(429).json({
        success: false,
        message: `Too many requests. Limit ${max} per ${windowMs / 1000}s.`,
      });
    }

    next();
  };
};

module.exports = createRateLimiter;
