import jwt from 'jsonwebtoken'
import User from './models/User.js'

export function createToken(user) {
  return jwt.sign({ sub: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: '7d' })
}

export async function authenticate(request, response, next) {
  try {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '')
    if (!token) return response.status(401).json({ message: 'Sign in to continue.' })
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    const user = await User.findById(payload.sub).select('_id username email')
    if (!user) return response.status(401).json({ message: 'Your session is no longer valid.' })
    request.user = user
    next()
  } catch {
    response.status(401).json({ message: 'Your session is no longer valid.' })
  }
}