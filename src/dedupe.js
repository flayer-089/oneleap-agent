const { appendRow } = require('./logger');

class DedupeTracker {
  constructor() {
    this.seenIds = new Set();
    this.newlyContacted = new Set();
  }

  loadFromLog(logFilePath) {
    return appendRow({ uniqueId: '__init__' }).catch(() => null);
  }

  isDuplicate(uniqueId) {
    return this.seenIds.has(uniqueId);
  }

  markContacted(uniqueId) {
    this.seenIds.add(uniqueId);
    this.newlyContacted.add(uniqueId);
  }

  getNewlyContactedCount() {
    return this.newlyContacted.size;
  }
}

module.exports = { DedupeTracker };
