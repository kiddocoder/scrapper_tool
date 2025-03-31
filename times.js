const parseTextDuration = (text) => {
  // Simple implementation, you may want to add more complexity
  const match = text.match(/(\d+) (minutes?|hours?|days?)/);
  if (match) {
    const value = parseInt(match[1]);
    const unit = match[2];
    switch (unit) {
      case "minutes":
        return value * 60 * 1000;
      case "hours":
        return value * 60 * 60 * 1000;
      case "days":
        return value * 24 * 60 * 60 * 1000;
      default:
        return 0;
    }
  }
  return 0;
};

module.exports = { parseTextDuration };
