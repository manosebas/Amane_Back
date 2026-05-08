import { Router } from 'express'
import { requireAuth } from '../middlewares/auth.js'

const router = Router()

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user })
})

export default router
