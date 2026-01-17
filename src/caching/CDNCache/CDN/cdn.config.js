import "dotenv/config";

export const CDNURI =
    "http://" +
    process.env.CDN_PRIVATE_DOMAIN +
    ":" +
    process.env.CDN_PORT;

export const CDNAUTH = process.env.JWT_CDN_PUBLIC;
