const oldDataChecker = async (data) => {
    try {
        const tenSecondsAgo = Date.now() - 10 * 1000;
        const updatedAt = new Date(data.updatedAt).getTime();
        return updatedAt >= tenSecondsAgo;
    } catch (error) {
        return true
    }
}

export default oldDataChecker