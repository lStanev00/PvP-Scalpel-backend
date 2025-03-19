const oldDataChecker = async (data) => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const updatedAt = new Date(data.updatedAt).getTime();
    return updatedAt < oneHourAgo ? false : true
}

export default oldDataChecker