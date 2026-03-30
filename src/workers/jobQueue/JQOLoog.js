const formatMessage = (msg) => `[JQOrchestrator] ${msg}`;

const JQOLog = {
    log(msg) {
        console.log(formatMessage(msg));
    },
    info(msg) {
        console.info(formatMessage(msg));
    },
    warn(msg) {
        console.warn(formatMessage(msg));
    },
    error(msg) {
        console.error(formatMessage(msg));
    },
};

export default JQOLog;
