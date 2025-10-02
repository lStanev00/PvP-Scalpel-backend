import sanitizeHtml from 'sanitize-html';
import isPlainObject from '../helpers/objectCheck.js';

export function sanitizeValue(value) {
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
        sanitizeInPlace(value);
        return value;
    }
    return value;
}

function sanitizeInPlace(obj) {
    for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (typeof val === 'string') {
            obj[key] = sanitizeHtml(val, {
                allowedTags: [],
                allowedAttributes: {}
            }).trim();
        } else if (Array.isArray(val)) {
            obj[key] = val.map(sanitizeValue);
        } else if (val && isPlainObject(val)) {
            sanitizeInPlace(val);
        }
    }
}

export default function sanitizer(req, res, next) {
    if (req.body && isPlainObject(req.body)) {
        sanitizeInPlace(req.body);
    }

    if (req.query && isPlainObject(req.query)) {
        sanitizeInPlace(req.query);
    }

    if (req.params && isPlainObject(req.params)) {
        sanitizeInPlace(req.params);
    }

    next();
}
