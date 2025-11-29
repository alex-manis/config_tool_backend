// Define types for Publisher Configuration
export type ConfigValue = string | number | boolean | null | (string | Page)[];

// standard keys that are part of PublisherConfig
export interface Page {
  pageType: string;
  selector: string;
  position: string;
}

// Main interface for Publisher Configuration
export interface PublisherConfig {
  publisherId: string;
  aliasName: string;
  isActive: boolean;
  pages: Page[];
  publisherDashboard: string;
  monitorDashboard: string;
  qaStatusDashboard: string;
  customCss?: string;
  tags?: string[];
  notes?: string;
  [key: string]: ConfigValue | undefined;
}

// Interface for Publisher List Item
export interface PublisherListItem {
  id: string;
  alias: string;
  file: string;
}


