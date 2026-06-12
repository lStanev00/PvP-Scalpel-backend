import { Router } from "express";
import MediaManifest from "../Models/MediaMeta.js";
import { jsonMessage, jsonResponse } from "../helpers/resposeHelpers.js";
import { createMediaPOST, requireAdmin } from "./route_logic/mediaCTRL/createMediaPOST.js";

const mediaCTRL = Router();

mediaCTRL.post("/media", requireAdmin, createMediaPOST);

export default mediaCTRL;