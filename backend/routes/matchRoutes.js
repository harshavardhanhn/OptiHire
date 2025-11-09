const express = require("express")
const axios = require("axios")
const NodeCache = require("node-cache")
const router = express.Router()

const cache = new NodeCache({ stdTTL: 3600, checkperiod: 120 }) // 1 hour TTL

// Expect the ML service to expose a JSON analyze endpoint (Flask app: /analyze)
const ML_URL = process.env.ML_URL || "http://localhost:5000/analyze"
const CACHE_KEY_PREFIX = "match_"

function validatePayload(p) {
  if (!p) return "empty payload"
  if (!p.profile) return "missing profile"
  if (!p.job_text) return "missing job_text"
  if (typeof p.profile !== "object") return "profile must be an object"
  if (typeof p.job_text !== "string") return "job_text must be a string"
  if (p.job_text.length < 20) return "job_text too short (minimum 20 characters)"
  return null
}

function generateCacheKey(profile, jobText) {
  // Create a hash-like key for caching
  const profileHash = JSON.stringify(profile).slice(0, 50)
  const jobHash = jobText.slice(0, 50)
  return `${CACHE_KEY_PREFIX}${profileHash}_${jobHash}`
}

router.post("/match", async (req, res) => {
  try {
    const validationError = validatePayload(req.body)
    if (validationError) {
      return res.status(400).json({
        error: validationError,
        code: "VALIDATION_ERROR",
      })
    }

  const { profile, job_text } = req.body

    const cacheKey = generateCacheKey(profile, job_text)
    const cached = cache.get(cacheKey)
    if (cached) {
      return res.json({
        ...cached,
        fromCache: true,
      })
    }

  const safeJob = typeof job_text === "string" ? job_text.slice(0, 20000) : ""

    let mlResp
    const maxRetries = 2
    let lastError

    for (let i = 0; i < maxRetries; i++) {
      try {
        // Call the ML service with a job object (ML service expects { profile, job })
        mlResp = await axios.post(
          ML_URL,
          { profile, job: { title: '', description: safeJob } },
          {
            timeout: 30000,
            headers: {
              "Content-Type": "application/json",
              "User-Agent": "OptiHire/2.0",
            },
          },
        )
        break
      } catch (err) {
        lastError = err
        if (i < maxRetries - 1) {
          await new Promise((r) => setTimeout(r, 1000 * (i + 1))) // Exponential backoff
        }
      }
    }

    if (!mlResp || !mlResp.data) {
      throw lastError || new Error("Invalid ML response")
    }

  // Normalize ML response fields (support different ML service shapes)
  const ml = mlResp.data || {}

  // If the ML service returns a packaged analysis (Flask: { success: True, analysis: {...} })
  let analysis = ml.analysis || ml

  const score = analysis.overall_score ?? analysis.matchScore ?? analysis.score ?? 0
  const matched_skills = analysis.matched_skills ?? analysis.matchedSkills ?? analysis.matchedSkills ?? []
  const missing_skills = analysis.missing_skills ?? analysis.missingSkills ?? []
  const suggestions = analysis.suggestions ?? ml.suggestions ?? ml.suggestions ?? []
  const matched_count = analysis.matched_count ?? matched_skills.length
  const total_skills = analysis.total_required ?? analysis.total_skills ?? (matched_skills.length + missing_skills.length)

    const result = {
      score,
      matched_skills,
      missing_skills,
      suggestions,
      matched_count,
      total_skills,
      matchedAt: new Date().toISOString(),
    }

    cache.set(cacheKey, result)

    return res.json(result)
  } catch (err) {
    console.error("Match error:", err.message || err)
    const status = err.response?.status || 500
    const detail = err.response?.data || err.message

    return res.status(status).json({
      error: "Matching service failed",
      detail,
      code: "ML_SERVICE_ERROR",
      timestamp: new Date().toISOString(),
    })
  }
})

router.post("/match-batch", async (req, res) => {
  try {
    const { profile, jobs } = req.body

    if (!profile || !Array.isArray(jobs) || jobs.length === 0) {
      return res.status(400).json({
        error: "Invalid batch request",
        code: "BATCH_VALIDATION_ERROR",
      })
    }

    if (jobs.length > 10) {
      return res.status(400).json({
        error: "Maximum 10 jobs per batch",
        code: "BATCH_SIZE_EXCEEDED",
      })
    }

    const results = await Promise.all(
      jobs.map((job) =>
        axios
          .post(
            ML_URL,
            { profile, job: { title: job.title || '', description: job.text || job.description || '' } },
            { timeout: 30000 },
          )
          .then((r) => ({ jobId: job.id, ...r.data }))
          .catch((err) => ({ jobId: job.id, error: err.message })),
      ),
    )

    return res.json({
      batch_id: `batch_${Date.now()}`,
      results,
      processedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error("Batch match error:", err)
    return res.status(500).json({
      error: "Batch matching failed",
      code: "BATCH_ERROR",
    })
  }
})

router.get("/cache-stats", (req, res) => {
  const keys = cache.keys()
  res.json({
    cached_matches: keys.length,
    cache_size: keys.reduce((sum, key) => sum + JSON.stringify(cache.get(key)).length, 0),
    timestamp: new Date().toISOString(),
  })
})

router.post("/cache-clear", (req, res) => {
  cache.flushAll()
  res.json({
    message: "Cache cleared",
    timestamp: new Date().toISOString(),
  })
})

// Simple zero-cost assistant endpoint (rule-based templates)
router.post('/assistant', (req, res) => {
  try {
    const { profile, job, lastMatch, message } = req.body
    if (!message) return res.status(400).json({ error: 'missing message' })

    const m = (message || '').toLowerCase()
    const matched = (lastMatch?.matched_skills || lastMatch?.matchedSkills || []).slice(0, 12)
    const missing = (lastMatch?.missing_skills || lastMatch?.missingSkills || []).slice(0, 12)
    const score = lastMatch?.score ?? lastMatch?.matchScore ?? 0

    let intent = 'unknown'
    let reply = ''
    const quick_replies = []

    if (/improv|improve|learn|recommend|how to/i.test(message)) {
      intent = 'improve'
      const topMissing = missing.slice(0, 5)
      if (topMissing.length) {
        reply = `To improve your match, focus on these skills: ${topMissing.join(', ')}. Practical steps: add projects demonstrating these skills, take short courses, and include them in your headline/summary.`
      } else if (lastMatch?.suggestions && lastMatch.suggestions.length) {
        reply = `Suggestions: ${lastMatch.suggestions.slice(0,3).join('; ')}`
      } else {
        reply = 'I could not detect clear missing skills. Consider improving your profile summary and highlighting project experience.'
      }
      quick_replies.push('Which skills are missing?', 'Give me a learning plan')
    } else if (/match|matched|which skills|what matched/i.test(message)) {
      intent = 'matched_skills'
      reply = matched.length ? `Matched skills: ${matched.join(', ')}` : 'No matched skills were detected.'
      quick_replies.push('How to improve', 'Show missing skills')
    } else if (/missing|lack|need to|missing skills/i.test(message)) {
      intent = 'missing_skills'
      reply = missing.length ? `Missing skills: ${missing.join(', ')}` : 'No missing skills detected.'
      quick_replies.push('How to improve', 'Show matched skills')
    } else if (/score|how good|percent/i.test(message)) {
      intent = 'score'
      reply = `Match score: ${Math.round(score)}%`
      quick_replies.push('How to improve', 'Show details')
    } else {
      // generic summary
      intent = 'summary'
      const s = []
      if (matched.length) s.push(`Matched: ${matched.slice(0,6).join(', ')}`)
      if (missing.length) s.push(`Missing: ${missing.slice(0,6).join(', ')}`)
      s.push(`Score: ${Math.round(score)}%`)
      reply = s.join(' | ')
      quick_replies.push('How to improve', 'Show matched skills', 'Show missing skills')
    }

    return res.json({ reply, intent, suggestions: lastMatch?.suggestions || [], quick_replies })
  } catch (err) {
    console.error('Assistant error', err)
    return res.status(500).json({ error: 'assistant_failed' })
  }
})

module.exports = router
