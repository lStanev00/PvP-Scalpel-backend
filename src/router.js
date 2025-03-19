import { Router } from "express";
import memberCtrl from "./controllers/memberCtrl.js";
import LDBController from "./controllers/LDBController.js";
import characterSearchCTRL from "./controllers/characterSearchCTRL.js";

const router = Router();

// router.use(`*`, (req,res, next) => {console.log(`ROUTING`); next()});

router.use(`/`, memberCtrl);
router.use(`/`, LDBController);
router.use(`/`, characterSearchCTRL);

export default router