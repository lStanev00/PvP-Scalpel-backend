import jwt from 'jsonwebtoken';

function validateToken(token, JWT_SECRET) {
    try {
        const Authorization = jwt.verify(token, JWT_SECRET); 
        return Authorization;     
    } catch (error) {
        return undefined;
    }
}

export default validateToken