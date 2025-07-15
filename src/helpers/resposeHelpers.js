export function jsonMessage(res, status, msg) {
    return res.status(status).json({ message: msg }).end;
}
  
export function jsonResponse(res, status, data = undefined) {
    if(!data) return res.status(status).end();
    return res.status(status).json(data);
}
  