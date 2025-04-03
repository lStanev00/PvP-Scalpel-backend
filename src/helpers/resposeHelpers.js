export function jsonMessage(res, status, msg) {
    return res.status(status).json({ message: msg });
  }
  