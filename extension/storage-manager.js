/**
 * OptiHire Storage Manager
 * Handles local storage, syncing, and data persistence across extension components
 */

// Declare chrome variable for linting purposes
const chrome = window.chrome

class StorageManager {
  constructor() {
    this.initialized = false
    this.listeners = new Set()
    this.initializeStorage()
  }

  /**
   * Initialize storage with default schema
   */
  async initializeStorage() {
    const defaults = {
      userProfile: null,
      jobMatches: [],
      savedJobs: [],
      preferences: {
        showNotifications: true,
        autoSync: true,
        storageSize: 0,
      },
      metadata: {
        lastSync: null,
        version: "2.0",
        createdAt: new Date().toISOString(),
      },
    }

    try {
      const stored = await this.getAll()
      if (!stored.userProfile) {
        await this.set("userProfile", null)
        await this.set("jobMatches", [])
        await this.set("savedJobs", [])
        await this.set("preferences", defaults.preferences)
        await this.set("metadata", defaults.metadata)
      }
      this.initialized = true
    } catch (error) {
      console.error("[StorageManager] Initialization error:", error)
    }
  }

  /**
   * Get a value from storage
   */
  async get(key) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get([key], (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError)
        } else {
          resolve(result[key])
        }
      })
    })
  }

  /**
   * Set a value in storage
   */
  async set(key, value) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [key]: value }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError)
        } else {
          this.notifyListeners({ key, value, action: "set" })
          resolve()
        }
      })
    })
  }

  /**
   * Get all stored data
   */
  async getAll() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(null, (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError)
        } else {
          resolve(result)
        }
      })
    })
  }

  /**
   * Save user profile with validation
   */
  async saveProfile(profile) {
    if (!profile || !profile.name) {
      throw new Error("Invalid profile: missing name")
    }

    const validProfile = {
      name: profile.name || "",
      title: profile.title || "",
      skills: Array.isArray(profile.skills) ? profile.skills : [],
      experience: Array.isArray(profile.experience) ? profile.experience : [],
      certifications: Array.isArray(profile.certifications) ? profile.certifications : [],
      education: Array.isArray(profile.education) ? profile.education : [],
      summary: profile.summary || "",
      extractedAt: new Date().toISOString(),
    }

    await this.set("userProfile", validProfile)
    await this.updateMetadata("lastSync", new Date().toISOString())
    return validProfile
  }

  /**
   * Get user profile
   */
  async getProfile() {
    return await this.get("userProfile")
  }

  /**
   * Save a job match result
   */
  async saveJobMatch(matchData) {
    if (!matchData || !matchData.jobTitle) {
      throw new Error("Invalid match data: missing jobTitle")
    }

    const matches = (await this.get("jobMatches")) || []
    const newMatch = {
      id: `match_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      score: matchData.score || 0,
      jobTitle: matchData.jobTitle,
      company: matchData.company || "",
      matchedSkills: matchData.matched_skills || [],
      missingSkills: matchData.missing_skills || [],
      suggestions: matchData.suggestions || [],
      matchedAt: new Date().toISOString(),
      jobUrl: matchData.jobUrl || "",
      ...matchData,
    }

    matches.unshift(newMatch)
    const maxMatches = 100
    if (matches.length > maxMatches) {
      matches.splice(maxMatches)
    }

    await this.set("jobMatches", matches)
    await this.updateMetadata("lastSync", new Date().toISOString())
    return newMatch
  }

  /**
   * Get all job matches
   */
  async getJobMatches(limit = 50) {
    const matches = (await this.get("jobMatches")) || []
    return matches.slice(0, limit)
  }

  /**
   * Save a job to favorites
   */
  async saveJob(jobData) {
    if (!jobData || !jobData.jobTitle) {
      throw new Error("Invalid job data: missing jobTitle")
    }

    const saved = (await this.get("savedJobs")) || []
    const newJob = {
      id: `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      jobTitle: jobData.jobTitle,
      company: jobData.company || "",
      jobUrl: jobData.jobUrl || "",
      matchScore: jobData.matchScore || 0,
      savedAt: new Date().toISOString(),
      notes: jobData.notes || "",
      ...jobData,
    }

    saved.unshift(newJob)
    await this.set("savedJobs", saved)
    return newJob
  }

  /**
   * Get saved jobs
   */
  async getSavedJobs(limit = 50) {
    const saved = (await this.get("savedJobs")) || []
    return saved.slice(0, limit)
  }

  /**
   * Remove a saved job
   */
  async removeSavedJob(jobId) {
    const saved = (await this.get("savedJobs")) || []
    const filtered = saved.filter((job) => job.id !== jobId)
    await this.set("savedJobs", filtered)
    return filtered
  }

  /**
   * Clear all user data
   */
  async clearAll() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.clear(() => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError)
        } else {
          this.notifyListeners({ action: "clear" })
          this.initializeStorage()
          resolve()
        }
      })
    })
  }

  /**
   * Get storage usage stats
   */
  async getStats() {
    const data = await this.getAll()
    const stats = {
      profiles: (await this.get("userProfile")) ? 1 : 0,
      jobMatches: ((await this.get("jobMatches")) || []).length,
      savedJobs: ((await this.get("savedJobs")) || []).length,
      lastSync: (await this.getMetadata("lastSync")) || null,
    }
    return stats
  }

  /**
   * Update metadata
   */
  async updateMetadata(key, value) {
    const metadata = (await this.get("metadata")) || {}
    metadata[key] = value
    await this.set("metadata", metadata)
  }

  /**
   * Get metadata
   */
  async getMetadata(key) {
    const metadata = (await this.get("metadata")) || {}
    return metadata[key]
  }

  /**
   * Subscribe to storage changes
   */
  onStorageChange(callback) {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  /**
   * Notify all listeners of storage changes
   */
  notifyListeners(change) {
    this.listeners.forEach((callback) => {
      try {
        callback(change)
      } catch (error) {
        console.error("[StorageManager] Listener error:", error)
      }
    })
  }

  /**
   * Export all data for backup
   */
  async exportData() {
    const data = await this.getAll()
    return {
      version: "2.0",
      exportedAt: new Date().toISOString(),
      data,
    }
  }

  /**
   * Import data from backup
   */
  async importData(backup) {
    if (!backup || !backup.data) {
      throw new Error("Invalid backup format")
    }

    const allowedKeys = ["userProfile", "jobMatches", "savedJobs", "preferences", "metadata"]
    for (const key of allowedKeys) {
      if (key in backup.data) {
        await this.set(key, backup.data[key])
      }
    }

    await this.updateMetadata("lastImport", new Date().toISOString())
    this.notifyListeners({ action: "import" })
  }
}

// Export singleton instance on the window so popup scripts can access it as window.storageManager
window.storageManager = new StorageManager()
const storageManager = window.storageManager
