import sanitizeHtml from 'sanitize-html';
import isPlainObject from '../helpers/objectCheck.js';

function sanitizeValue(value) {
    if (typeof value === 'string') {
        return sanitizeHtml(value, {
            allowedTags: [],
            allowedAttributes: {}
        }).trim();
    }
    if (Array.isArray(value)) {
        return value.map(sanitizeValue);
    }
    if (value && isPlainObject(value)) {
        return sanitizeObject(value);
    }
    return value;
}

function sanitizeObject(obj) {
    const cleanObj = {};
    for (const key of Object.keys(obj)) {
        cleanObj[key] = sanitizeValue(obj[key]);
    }
    return cleanObj;
}

export default function sanitizer(req, res, next) {
    if (req.body)   req.body   = sanitizeObject(req.body);
    if (req.query)  req.query  = sanitizeObject(req.query);
    if (req.params) req.params = sanitizeObject(req.params);
    next();
}
