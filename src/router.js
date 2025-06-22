import { Router } from "express";
import memberCtrl from "./controllers/memberCtrl.js";
import LDBController from "./controllers/LDBController.js";
import {characterSearchCTRL} from "./controllers/characterSearchCTRL.js";
import authController from "./controllers/authentication.js";
import {authMiddleware} from "./middlewares/authMiddleweare.js";
import postsCTRL from "./controllers/postsCTRL.js";
import userActionCTRL from "./controllers/userActionsCTRL.js";

const router = Router();

// router.use(`*`, (req,res, next) => {console.log(`ROUTING`); next()});
router.use('/', authMiddleware);
router.use(`/`, authController);
router.use(`/`, memberCtrl);
router.use(`/`, LDBController);
router.use(`/`, characterSearchCTRL);
router.use(`/`, postsCTRL)
router.use(`/`, userActionCTRL);

export default router