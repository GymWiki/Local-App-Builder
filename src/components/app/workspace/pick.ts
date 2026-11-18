/** Een door de gebruiker gekozen onderdeel in de preview, zoals het pickerscript het doorgeeft (zie mcp-server/src/picker-script.ts). */
export interface BreadcrumbItem {
  /** Korte naam, bijvoorbeeld "div.hero" of "h1". */
  label: string;
  selector: string;
}

export interface PickedElement {
  selector: string;
  tag: string;
  text: string;
  path: string;
  breadcrumb: BreadcrumbItem[];
}
