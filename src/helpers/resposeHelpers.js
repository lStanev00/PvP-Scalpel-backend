export function jsonMessage(res, status, msg) {
    return res.status(status).json({ message: msg });
}
  
export function jsonResponse(res, status, data) {
    return res.status(status).json(data);
}
  