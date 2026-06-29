import { Router } from "express";
import MediaManifest from "../Models/MediaMeta.js";
import { jsonMessage, jsonResponse } from "../helpers/resposeHelpers.js";
import { createMediaPOST, requireAdmin } from "./route_logic/mediaCTRL/createMediaPOST.js";
import userMediaGET from "./route_logic/mediaCTRL/userMediaGET.js";
import updateMediaPATCH from "./route_logic/mediaCTRL/updateMediaPATCH.js";

const mediaCTRL = Router();

mediaCTRL.post("/media", requireAdmin, createMediaPOST);
mediaCTRL.patch("/media", updateMediaPATCH);
mediaCTRL.get("/userMedia", requireAdmin, userMediaGET);


export default mediaCTRL;