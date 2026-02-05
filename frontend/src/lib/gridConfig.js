/**\n * Centralized AG Grid Configuration\n * \n * This module provides shared configuration for all AG Grid instances\n * in the application, ensuring consistent styling, behavior, and performance.\n * \n * Features:\n * - Unified column defaults with tooltips for truncated content\n * - Common grid props (row height, virtualization, etc.)\n * - CSS theme variables for consistent styling\n * - Filter configurations for text, number, and date columns\n */

/**
 * Default column definition for all grids
 * Includes: sorting, resizing, tooltips for truncated content
 */
export const defaultColDef = {
  sortable: true,
  resizable: true,
  // Tooltip for cells with truncated content
  tooltipValueGetter: (params) => {
    // Return value as tooltip if content is longer than cell
    const value = params.valueFormatted ?? params.value;
    return value != null ? String(value) : null;
  },
};

/**
 * Default column definition with filters (for grids and similar)
 * Extends defaultColDef with filtering capabilities
 */
export const defaultColDefWithFilter = {
  ...defaultColDef,
  filter: true,
  floatingFilter: true,
};

/**
 * Common visual and performance settings for all grids
 */
export const commonGridProps = {
  theme: 'legacy',
  animateRows: false,
  headerHeight: 36,
  rowHeight: 24,
  domLayout: 'normal',
  // Tooltip settings
  tooltipShowDelay: 1300,
  tooltipHideDelay: 3000,
  enableBrowserTooltips: false,
  // Virtualization settings for performance
  rowBuffer: 50,
  suppressColumnVirtualisation: true,
  debounceVerticalScrollbar: true,
  suppressAnimationFrame: false,
};

/**
 * CSS custom properties for AG Grid theme customization
 * Applied as inline styles on grid container
 */
export const gridThemeStyles = {
  // Row striping
  '--ag-odd-row-background-color': '#fafbfc',
  '--ag-row-hover-color': '#e8f4fd',
  // Vertical and horizontal lines
  '--ag-row-border-color': '#e5e7eb',
  '--ag-cell-horizontal-border': '1px solid #f0f0f0',
  // Header styling
  '--ag-header-background-color': '#d5d9ddff',
  '--ag-header-foreground-color': '#0a0b0cff',
  '--ag-header-cell-hover-background-color': '#f1f5f9',
  // Selection colors
  '--ag-selected-row-background-color': '#dbeafe',
  '--ag-range-selection-background-color': '#bfdbfe',
  // Fonts and base colors
  '--ag-font-size': '13px',
  '--ag-font-family': 'system-ui, -apple-system, sans-serif',
  '--ag-foreground-color': '#374151',
  '--ag-background-color': '#ffffff',
  // Border styling
  '--ag-border-color': '#5c626eff',
  '--ag-secondary-border-color': '#f3f4f6',
  '--ag-wrapper-border-radius': '6px 6px 0 0',
};

/**
 * Creates style object for grid container with applied theme styles
 * @param {object} additionalStyles - Additional CSS styles to apply
 * @returns {object} - Combined style object
 */
export const getGridContainerStyle = (additionalStyles = {}) => ({
  height: '100%',
  width: '100%',
  ...gridThemeStyles,
  ...additionalStyles,
});

/**
 * Text filter configuration for substring matching
 */
export const textFilterParams = {
  filterOptions: ['contains', 'notContains', 'equals', 'notEqual', 'startsWith', 'endsWith'],
  defaultOption: 'contains',
  trimInput: true,
  debounceMs: 200,
};

/**
 * Number filter configuration with arithmetic operations
 */
export const numberFilterParams = {
  filterOptions: ['equals', 'notEqual', 'lessThan', 'lessThanOrEqual', 'greaterThan', 'greaterThanOrEqual', 'inRange'],
  defaultOption: 'greaterThanOrEqual',
  debounceMs: 200,
};

/**
 * Date filter configuration
 */
export const dateFilterParams = {
  filterOptions: ['equals', 'notEqual', 'lessThan', 'greaterThan', 'inRange'],
  defaultOption: 'equals',
  debounceMs: 200,
  comparator: (filterDate, cellValue) => {
    if (!cellValue) return -1;
    const cellDate = new Date(cellValue);
    if (filterDate.getTime() === cellDate.getTime()) return 0;
    return cellDate < filterDate ? -1 : 1;
  },
};

/**
 * Get filter type based on field name or explicit type
 * @param {string} field - Field name
 * @param {string} explicitType - Explicit type ('text', 'number', 'date')
 * @returns {object} - Filter configuration
 */
export const getFilterConfig = (field, explicitType) => {
  // Explicit type takes precedence
  if (explicitType === 'number') {
    return { filter: 'agNumberColumnFilter', filterParams: numberFilterParams };
  }
  if (explicitType === 'date') {
    return { filter: 'agDateColumnFilter', filterParams: dateFilterParams };
  }
  if (explicitType === 'text') {
    return { filter: 'agTextColumnFilter', filterParams: textFilterParams };
  }
  
  // Auto-detect based on field name
  const numberFields = ['id', 'count', 'price', 'amount', 'quantity', 'priceCount', 'sellerCount', 'itemCount'];
  const dateFields = ['date', 'created', 'updated', 'modified', 'minDate', 'maxDate', 'startedAt', 'finishedAt'];
  
  const lowerField = field?.toLowerCase() || '';
  
  if (numberFields.some(nf => lowerField.includes(nf.toLowerCase()))) {
    return { filter: 'agNumberColumnFilter', filterParams: numberFilterParams };
  }
  if (dateFields.some(df => lowerField.includes(df.toLowerCase()))) {
    return { filter: 'agDateColumnFilter', filterParams: dateFilterParams };
  }
  
  return { filter: 'agTextColumnFilter', filterParams: textFilterParams };
};

/**
 * Helper to create column definition with appropriate filter
 * @param {object} colDef - Base column definition
 * @param {string} filterType - Filter type ('text', 'number', 'date', or undefined for auto-detect)
 * @returns {object} - Extended column definition with filter
 */
export const withFilter = (colDef, filterType) => ({
  ...colDef,
  ...getFilterConfig(colDef.field, filterType),
});
