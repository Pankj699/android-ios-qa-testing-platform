/**
 * Pure utility functions for Mixpanel Attribute Filtering in the Event Inspector.
 */

export const ATTRIBUTE_STATUSES = {
  ALL: 'ALL',
  MATCHED: 'MATCHED',
  MISSING: 'MISSING',
  EXTRA: 'EXTRA',
  INCORRECT: 'INCORRECT'
};

/**
 * Filter attribute list by status.
 * @param {Array} attributes - List of validated attribute objects
 * @param {string} filterStatus - Status to filter by ('ALL', 'MATCHED', 'MISSING', 'EXTRA', 'INCORRECT')
 * @returns {Array} Filtered list of attributes
 */
export function filterAttributesByStatus(attributes, filterStatus) {
  if (!Array.isArray(attributes)) return [];
  if (!filterStatus || filterStatus === ATTRIBUTE_STATUSES.ALL) {
    return attributes;
  }
  return attributes.filter(attr => attr && attr.status === filterStatus);
}

/**
 * Get human-readable title for a status.
 * @param {string} status
 * @returns {string}
 */
export function getStatusTitle(status) {
  switch (status) {
    case ATTRIBUTE_STATUSES.MATCHED:
      return 'Matched';
    case ATTRIBUTE_STATUSES.MISSING:
      return 'Missing';
    case ATTRIBUTE_STATUSES.EXTRA:
      return 'Extra';
    case ATTRIBUTE_STATUSES.INCORRECT:
      return 'Incorrect';
    case ATTRIBUTE_STATUSES.ALL:
      return 'All Attributes';
    default:
      return status || 'All Attributes';
  }
}

/**
 * Generates the user-facing empty state message for a given status filter.
 * @param {string} filterStatus
 * @returns {string}
 */
export function getEmptyStateMessage(filterStatus) {
  if (!filterStatus || filterStatus === ATTRIBUTE_STATUSES.ALL) {
    return 'No parameter attributes found for this event.';
  }
  const title = getStatusTitle(filterStatus);
  return `No attributes with ${title} status for this event.`;
}
