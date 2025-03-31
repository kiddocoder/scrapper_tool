/**
 *  const logger: {
    error: (message: any) => void;
    info: (message: any) => void;
    debug: (message: any) => void;
}
 */
const logger = {
  error: (message) => {
    console.error(message);
  },
  info: (message) => {
    console.info(message);
  },
  debug: (message) => {
    console.debug(message);
  },
};

module.exports = { logger };
