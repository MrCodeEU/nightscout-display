import streamDeck, { action, DidReceiveSettingsEvent, KeyDownEvent, KeyUpEvent, SingletonAction, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";

/**
 * Settings for the Nightscout action.
 */
type Settings = {
	nightscoutUrl?: string;
	token?: string;
	unit: "mgdl" | "mmol";
	normalHigh: number;
	normalLow: number;
	urgentHigh: number;
	urgentLow: number;
	inRangeColor: string;
	normalColor: string;
	urgentColor: string;
	graphHours: number; // 4, 8, 12, 24, or 48
};

/**
 * Nightscout API response types
 */
type NightscoutResponse = {
	bgnow?: {
		last?: number;
		mills?: number;
	};
	delta?: {
		display?: string;
		scaled?: number;
	};
	direction?: {
		label?: string;
	};
	buckets?: Array<{
		fromMills: number;
		toMills: number;
	}>;
};

type NightscoutEntry = {
	sgv: number;
	date: number;
	direction?: string;
};

/**
 * Display modes for the key
 */
enum DisplayMode {
	NUMBER = "number",
	GRAPH = "graph"
}

/**
 * Map Nightscout direction text to arrow symbols
 */
const DIRECTION_ARROWS: Record<string, string> = {
	"DoubleUp": "⇈",
	"SingleUp": "↑",
	"FortyFiveUp": "↗",
	"Flat": "→",
	"FortyFiveDown": "↘",
	"SingleDown": "↓",
	"DoubleDown": "⇊",
	"NOT COMPUTABLE": "?",
	"RATE OUT OF RANGE": "⚠"
};

/**
 * Action to display Nightscout blood glucose data with graph visualization.
 * - Click to toggle between number and graph view
 * - Long press (hold for 500ms+) to force refresh
 */
@action({ UUID: "com.mrcodeeu.nightscout-display.action" })
export class NightscoutAction extends SingletonAction<Settings> {
	private readonly WIDTH = 144;
	private readonly HEIGHT = 144;
	private readonly LONG_PRESS_DURATION = 500; // ms
	
	// Default settings
	private readonly DEFAULT_SETTINGS: Settings = {
		unit: "mgdl",
		normalHigh: 180,
		normalLow: 70,
		urgentHigh: 250,
		urgentLow: 55,
		inRangeColor: "#00FF00",
		normalColor: "#FFFF00",
		urgentColor: "#FF0000",
		graphHours: 8
	};

	// Instance state per context
	private instances = new Map<string, {
		displayMode: DisplayMode;
		keyDownTime?: number;
		fetchTimeout?: NodeJS.Timeout;
		renderTimeout?: NodeJS.Timeout;
		lastResponse?: NightscoutResponse;
		lastEntries?: NightscoutEntry[];
	}>();

	/**
	 * Initialize a new instance when the action appears
	 */
	override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
		streamDeck.logger.info(`Nightscout action appearing on key ${ev.action.id}`);
		const instance = {
			displayMode: DisplayMode.NUMBER,
			lastResponse: undefined,
			lastEntries: undefined
		};
		this.instances.set(ev.action.id, instance);
		
		streamDeck.logger.info("Starting initial fetch...");
		await this.fetchAndRender(ev.action.id, ev.payload.settings);
	}

	/**
	 * Clean up when the action disappears
	 */
	override async onWillDisappear(ev: WillDisappearEvent<Settings>): Promise<void> {
		const instance = this.instances.get(ev.action.id);
		if (instance) {
			if (instance.fetchTimeout) clearTimeout(instance.fetchTimeout);
			if (instance.renderTimeout) clearTimeout(instance.renderTimeout);
			this.instances.delete(ev.action.id);
		}
	}

	/**
	 * Handle key down - start tracking for long press
	 */
	override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
		const instance = this.instances.get(ev.action.id);
		if (instance) {
			instance.keyDownTime = Date.now();
		}
	}

	/**
	 * Handle key up - toggle view or force refresh based on press duration
	 */
	override async onKeyUp(ev: KeyUpEvent<Settings>): Promise<void> {
		const instance = this.instances.get(ev.action.id);
		if (!instance || !instance.keyDownTime) return;

		const pressDuration = Date.now() - instance.keyDownTime;
		instance.keyDownTime = undefined;

		if (pressDuration >= this.LONG_PRESS_DURATION) {
			// Long press - force refresh
			streamDeck.logger.info(`Long press detected (${pressDuration}ms) - forcing refresh`);
			await this.fetchAndRender(ev.action.id, ev.payload.settings, true);
		} else {
			// Short press - toggle display mode
			instance.displayMode = instance.displayMode === DisplayMode.NUMBER 
				? DisplayMode.GRAPH 
				: DisplayMode.NUMBER;
			streamDeck.logger.info(`Toggled to ${instance.displayMode} mode`);
			
			// Re-render with current data
			await this.render(ev.action.id, ev.payload.settings);
		}
	}

	/**
	 * Handle settings update
	 */
	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): Promise<void> {
		await this.fetchAndRender(ev.action.id, ev.payload.settings);
	}

	/**
	 * Fetch data from Nightscout and render
	 */
	private async fetchAndRender(contextId: string, settings: Settings, forceRefresh = false): Promise<void> {
		const instance = this.instances.get(contextId);
		if (!instance) return;

		// Clear existing timeouts
		if (instance.fetchTimeout) clearTimeout(instance.fetchTimeout);
		if (instance.renderTimeout) clearTimeout(instance.renderTimeout);

		const mergedSettings = { ...this.DEFAULT_SETTINGS, ...settings };

		if (!mergedSettings.nightscoutUrl) {
			streamDeck.logger.warn("Nightscout URL not configured");
			return;
		}

		try {
			// Prepare request headers
			const headers: Record<string, string> = {};
			if (mergedSettings.token) {
				// Hash the token with SHA-1 as per Nightscout API requirements
				const encoder = new TextEncoder();
				const data = encoder.encode(mergedSettings.token);
				const hashBuffer = await crypto.subtle.digest("SHA-1", data);
				const hashArray = Array.from(new Uint8Array(hashBuffer));
				const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
				headers["API-SECRET"] = hashHex;
			}

			// Fetch current reading and properties
			const url = new URL(mergedSettings.nightscoutUrl);
			url.pathname = url.pathname.replace(/\/$/, "") + "/api/v2/properties/bgnow,buckets,delta,direction";
			
			streamDeck.logger.info(`Fetching from: ${url.toString()}`);
			const response = await fetch(url.toString(), { headers });
			
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			const data = await response.json() as NightscoutResponse;
			instance.lastResponse = data;

			// Fetch entries for graph based on time frame (5 min readings)
			const entriesUrl = new URL(mergedSettings.nightscoutUrl);
			entriesUrl.pathname = entriesUrl.pathname.replace(/\/$/, "") + "/api/v1/entries.json";
			const entriesCount = Math.ceil((mergedSettings.graphHours * 60) / 5); // 5 min per reading
			entriesUrl.searchParams.set("count", entriesCount.toString());
			
			const entriesResponse = await fetch(entriesUrl.toString(), { headers });
			if (entriesResponse.ok) {
				instance.lastEntries = await entriesResponse.json() as NightscoutEntry[];
			}

			// Render the data
			await this.render(contextId, mergedSettings);

			// Schedule next fetch - check every 30 seconds for new data
			let sleepMs = 30000; // Check every 30 seconds
			const bucket = data.buckets?.[0];
			if (bucket && data.bgnow?.mills) {
				const lastDiff = bucket.toMills - bucket.fromMills;
				const nextRead = data.bgnow.mills + lastDiff + 15000; // Add 15s buffer
				const now = Date.now();
				if (nextRead > now && nextRead - now < 300000) { // Within 5 minutes
					sleepMs = Math.min(nextRead - now, 30000);
				}
			}

			streamDeck.logger.info(`Next fetch scheduled in ${Math.round(sleepMs / 1000)}s`);
			instance.fetchTimeout = setTimeout(() => this.fetchAndRender(contextId, settings), sleepMs);

		} catch (error) {
			streamDeck.logger.error(`Failed to fetch Nightscout data: ${error}`);
			await streamDeck.actions.getActionById(contextId)?.showAlert();
			
			// Retry in 1 minute on error
			instance.fetchTimeout = setTimeout(() => this.fetchAndRender(contextId, settings), 60000);
		}
	}

	/**
	 * Render the current data to the Stream Deck key
	 */
	private async render(contextId: string, settings: Settings): Promise<void> {
		const instance = this.instances.get(contextId);
		if (!instance || !instance.lastResponse) return;

		const mergedSettings = { ...this.DEFAULT_SETTINGS, ...settings };
		const data = instance.lastResponse;

		try {
			let svgContent: string;

			if (instance.displayMode === DisplayMode.NUMBER) {
				svgContent = this.renderNumber(data, mergedSettings);
			} else {
				svgContent = this.renderGraph(data, instance.lastEntries || [], mergedSettings);
			}

			// Set the rendered image
			const svgBase64 = Buffer.from(svgContent).toString("base64");
			await streamDeck.actions.getActionById(contextId)?.setImage(`data:image/svg+xml;base64,${svgBase64}`);

			// Schedule periodic re-render to update "ago" time
			if (instance.renderTimeout) clearTimeout(instance.renderTimeout);
			instance.renderTimeout = setTimeout(() => this.render(contextId, settings), 60000);

		} catch (error) {
			streamDeck.logger.error(`Failed to render: ${error}`);
		}
	}

	/**
	 * Render number view with glucose reading, delta, and arrow
	 */
	private renderNumber(data: NightscoutResponse, settings: Settings): string {
		let last = data.bgnow?.last;
		if (!last) {
			return `<svg width="${this.WIDTH}" height="${this.HEIGHT}" xmlns="http://www.w3.org/2000/svg">
				<rect width="${this.WIDTH}" height="${this.HEIGHT}" fill="#000000"/>
				<text x="${this.WIDTH / 2}" y="${this.HEIGHT / 2}" font-family="Arial" font-size="20" fill="#FFFFFF" text-anchor="middle" dominant-baseline="middle">No Data</text>
			</svg>`;
		}

		// Convert to mmol if needed
		if (settings.unit === "mmol") {
			last = Math.round((last / 18) * 10) / 10;
		}

		// Determine color based on thresholds
		let color = settings.inRangeColor;
		if (last >= settings.urgentHigh || last <= settings.urgentLow) {
			color = settings.urgentColor;
		} else if (last >= settings.normalHigh || last <= settings.normalLow) {
			color = settings.normalColor;
		}

		// Build delta and direction
		let delta = data.delta?.display || "";
		if (settings.unit === "mmol" && data.delta?.scaled) {
			const mmolDelta = Math.round((data.delta.scaled / 18) * 100) / 100;
			delta = mmolDelta >= 0 ? `+${mmolDelta}` : mmolDelta.toString();
		}
		
		// Get arrow symbol from direction
		const directionText = data.direction?.label || "Flat";
		const arrow = DIRECTION_ARROWS[directionText] || directionText;

		// Build time ago indicator
		let agoDisplay = "";
		if (data.bgnow?.mills) {
			const minutesAgo = Math.floor((Date.now() - data.bgnow.mills) / 60000);
			if (minutesAgo > 5) {
				agoDisplay = `${minutesAgo}m ago`;
			} else if (minutesAgo > 0) {
				agoDisplay = "–".repeat(minutesAgo).trim();
			} else {
				agoDisplay = "now";
			}
		}

		return `<svg width="${this.WIDTH}" height="${this.HEIGHT}" xmlns="http://www.w3.org/2000/svg">
			<rect width="${this.WIDTH}" height="${this.HEIGHT}" fill="#000000"/>
			
			<!-- Main glucose reading -->
			<text x="${this.WIDTH / 2}" y="${this.HEIGHT / 2 - 18}" font-family="Arial, sans-serif" font-size="52" font-weight="bold" fill="${color}" text-anchor="middle" dominant-baseline="middle">${last}</text>
			
			<!-- Arrow and delta -->
			<text x="${this.WIDTH / 2}" y="${this.HEIGHT / 2 + 28}" font-family="Arial, sans-serif" font-size="32" font-weight="bold" fill="${color}" text-anchor="middle" dominant-baseline="middle">${arrow}</text>
			<text x="${this.WIDTH / 2}" y="${this.HEIGHT / 2 + 52}" font-family="Arial, sans-serif" font-size="22" fill="${color}" text-anchor="middle" dominant-baseline="middle">${delta}</text>
			
			<!-- Time ago -->
			<text x="${this.WIDTH / 2}" y="${this.HEIGHT - 12}" font-family="Arial, sans-serif" font-size="16" fill="#888888" text-anchor="middle" dominant-baseline="middle">${agoDisplay}</text>
		</svg>`;
	}

	/**
	 * Render graph view with glucose trend line
	 */
	private renderGraph(data: NightscoutResponse, entries: NightscoutEntry[], settings: Settings): string {
		if (entries.length === 0) {
			return `<svg width="${this.WIDTH}" height="${this.HEIGHT}" xmlns="http://www.w3.org/2000/svg">
				<rect width="${this.WIDTH}" height="${this.HEIGHT}" fill="#000000"/>
				<text x="${this.WIDTH / 2}" y="${this.HEIGHT / 2}" font-family="Arial, sans-serif" font-size="18" fill="#FFFFFF" text-anchor="middle" dominant-baseline="middle">No History</text>
			</svg>`;
		}

		// Sort entries by date (oldest first)
		const sortedEntries = [...entries].sort((a, b) => a.date - b.date);

		// Convert to appropriate unit
		const values = sortedEntries.map(e => 
			settings.unit === "mmol" ? e.sgv / 18 : e.sgv
		);

		// Calculate range for graph with more padding for better visibility
		const maxThreshold = settings.unit === "mmol" ? settings.urgentHigh / 18 : settings.urgentHigh;
		const minThreshold = settings.unit === "mmol" ? settings.urgentLow / 18 : settings.urgentLow;
		const maxValue = Math.max(...values, maxThreshold);
		const minValue = Math.min(...values, minThreshold);
		const range = maxValue - minValue;
		const padding = range * 0.15;

		// Graph dimensions - larger graph area
		const graphTop = 28;
		const graphBottom = this.HEIGHT - 18;
		const graphLeft = 28;
		const graphRight = this.WIDTH - 12;
		const graphHeight = graphBottom - graphTop;
		const graphWidth = graphRight - graphLeft;

		// Calculate threshold positions
		const normalHigh = settings.unit === "mmol" ? settings.normalHigh / 18 : settings.normalHigh;
		const normalLow = settings.unit === "mmol" ? settings.normalLow / 18 : settings.normalLow;
		const urgentHigh = settings.unit === "mmol" ? settings.urgentHigh / 18 : settings.urgentHigh;
		const urgentLow = settings.unit === "mmol" ? settings.urgentLow / 18 : settings.urgentLow;
		
		// Helper to get Y position
		const getY = (value: number) => {
			return graphBottom - ((value - (minValue - padding)) / (range + 2 * padding)) * graphHeight;
		};

		// Build graph line path with smooth curve
		const pathPoints = values.map((value, index) => {
			const x = graphLeft + (index / (values.length - 1)) * graphWidth;
			const y = getY(value);
			return index === 0 ? `M${x},${y}` : `L${x},${y}`;
		}).join(" ");

		// Build circles for data points
		const circles = values.map((value, index) => {
			const x = graphLeft + (index / (values.length - 1)) * graphWidth;
			const y = getY(value);
			
			// Color based on value
			let color = settings.inRangeColor;
			if (value >= urgentHigh || value <= urgentLow) {
				color = settings.urgentColor;
			} else if (value >= normalHigh || value <= normalLow) {
				color = settings.normalColor;
			}
			
			const radius = index === values.length - 1 ? 3.5 : 1.8;
			const stroke = index === values.length - 1 ? `stroke="#FFFFFF" stroke-width="1.5"` : '';
			return `<circle cx="${x}" cy="${y}" r="${radius}" fill="${color}" ${stroke}/>`;
		}).join("");

		// Build threshold lines
		const normalHighY = getY(normalHigh);
		const normalLowY = getY(normalLow);
		const urgentHighY = getY(urgentHigh);
		const urgentLowY = getY(urgentLow);

		// Y-axis labels with better positioning
		const maxLabel = Math.round(maxValue + padding);
		const minLabel = Math.round(minValue - padding);
		const midLabel = Math.round((maxLabel + minLabel) / 2);

		// Time range label
		const timeRangeLabel = `${settings.graphHours}h`;

		// Build header with current value and arrow
		let headerText = "";
		let headerArrow = "";
		let currentValue = data.bgnow?.last;
		if (currentValue) {
			if (settings.unit === "mmol") {
				currentValue = Math.round((currentValue / 18) * 10) / 10;
			}
			
			let delta = data.delta?.display || "";
			if (settings.unit === "mmol" && data.delta?.scaled) {
				const mmolDelta = Math.round((data.delta.scaled / 18) * 100) / 100;
				delta = mmolDelta >= 0 ? `+${mmolDelta}` : mmolDelta.toString();
			}
			const directionText = data.direction?.label || "Flat";
			headerArrow = DIRECTION_ARROWS[directionText] || directionText;
			headerText = `${currentValue} ${delta}`;
		}

		// Get color for current value
		let currentColor = settings.inRangeColor;
		if (currentValue) {
			const val = settings.unit === "mmol" ? currentValue : currentValue;
			if (val >= urgentHigh || val <= urgentLow) {
				currentColor = settings.urgentColor;
			} else if (val >= normalHigh || val <= normalLow) {
				currentColor = settings.normalColor;
			}
		}

		return `<svg width="${this.WIDTH}" height="${this.HEIGHT}" xmlns="http://www.w3.org/2000/svg">
			<defs>
				<linearGradient id="urgentGrad" x1="0%" y1="0%" x2="0%" y2="100%">
					<stop offset="0%" style="stop-color:${settings.urgentColor};stop-opacity:0.3" />
					<stop offset="100%" style="stop-color:${settings.urgentColor};stop-opacity:0.15" />
				</linearGradient>
				<linearGradient id="normalGrad" x1="0%" y1="0%" x2="0%" y2="100%">
					<stop offset="0%" style="stop-color:${settings.normalColor};stop-opacity:0.25" />
					<stop offset="100%" style="stop-color:${settings.normalColor};stop-opacity:0.15" />
				</linearGradient>
				<linearGradient id="inRangeGrad" x1="0%" y1="0%" x2="0%" y2="100%">
					<stop offset="0%" style="stop-color:${settings.inRangeColor};stop-opacity:0.25" />
					<stop offset="100%" style="stop-color:${settings.inRangeColor};stop-opacity:0.15" />
				</linearGradient>
				<filter id="glow">
					<feGaussianBlur stdDeviation="1.5" result="coloredBlur"/>
					<feMerge>
						<feMergeNode in="coloredBlur"/>
						<feMergeNode in="SourceGraphic"/>
					</feMerge>
				</filter>
				<filter id="shadow">
					<feDropShadow dx="0" dy="1" stdDeviation="1" flood-opacity="0.5"/>
				</filter>
			</defs>
			
			<rect width="${this.WIDTH}" height="${this.HEIGHT}" fill="#0a0a0a"/>
			
			<!-- Grid lines with better visibility -->
			<line x1="${graphLeft}" y1="${getY(maxLabel)}" x2="${graphRight}" y2="${getY(maxLabel)}" stroke="#2a2a2a" stroke-width="1"/>
			<line x1="${graphLeft}" y1="${getY(midLabel)}" x2="${graphRight}" y2="${getY(midLabel)}" stroke="#2a2a2a" stroke-width="1"/>
			<line x1="${graphLeft}" y1="${getY(minLabel)}" x2="${graphRight}" y2="${getY(minLabel)}" stroke="#2a2a2a" stroke-width="1"/>
			
			<!-- Range zones with gradients -->
			<rect x="${graphLeft}" y="${graphTop}" width="${graphWidth}" height="${urgentHighY - graphTop}" fill="url(#urgentGrad)"/>
			<rect x="${graphLeft}" y="${urgentHighY}" width="${graphWidth}" height="${normalHighY - urgentHighY}" fill="url(#normalGrad)"/>
			<rect x="${graphLeft}" y="${normalHighY}" width="${graphWidth}" height="${normalLowY - normalHighY}" fill="url(#inRangeGrad)"/>
			<rect x="${graphLeft}" y="${normalLowY}" width="${graphWidth}" height="${urgentLowY - normalLowY}" fill="url(#normalGrad)"/>
			<rect x="${graphLeft}" y="${urgentLowY}" width="${graphWidth}" height="${graphBottom - urgentLowY}" fill="url(#urgentGrad)"/>
			
			<!-- Threshold lines with better visibility -->
			<line x1="${graphLeft}" y1="${urgentHighY}" x2="${graphRight}" y2="${urgentHighY}" stroke="${settings.urgentColor}" stroke-width="1.5" stroke-dasharray="4,2" opacity="0.8"/>
			<line x1="${graphLeft}" y1="${normalHighY}" x2="${graphRight}" y2="${normalHighY}" stroke="${settings.normalColor}" stroke-width="1.5" stroke-dasharray="3,3" opacity="0.7"/>
			<line x1="${graphLeft}" y1="${normalLowY}" x2="${graphRight}" y2="${normalLowY}" stroke="${settings.normalColor}" stroke-width="1.5" stroke-dasharray="3,3" opacity="0.7"/>
			<line x1="${graphLeft}" y1="${urgentLowY}" x2="${graphRight}" y2="${urgentLowY}" stroke="${settings.urgentColor}" stroke-width="1.5" stroke-dasharray="4,2" opacity="0.8"/>
			
			<!-- Y-axis labels with shadow for better readability -->
			<text x="4" y="${getY(maxLabel)}" font-family="Arial, sans-serif" font-size="11" font-weight="600" fill="#888888" dominant-baseline="middle" filter="url(#shadow)">${maxLabel}</text>
			<text x="4" y="${getY(midLabel)}" font-family="Arial, sans-serif" font-size="11" font-weight="600" fill="#888888" dominant-baseline="middle" filter="url(#shadow)">${midLabel}</text>
			<text x="4" y="${getY(minLabel)}" font-family="Arial, sans-serif" font-size="11" font-weight="600" fill="#888888" dominant-baseline="middle" filter="url(#shadow)">${minLabel}</text>
			
			<!-- Glucose trend line with glow effect -->
			<path d="${pathPoints}" stroke="#FFFFFF" stroke-width="3" fill="none" opacity="0.95" filter="url(#glow)"/>
			
			<!-- Data points -->
			${circles}
			
			<!-- Current value with arrow and shadow -->
			<text x="8" y="12" font-family="Arial, sans-serif" font-size="18" font-weight="bold" fill="${currentColor}" dominant-baseline="middle" filter="url(#shadow)">${headerText}</text>
			<text x="${this.WIDTH - 20}" y="12" font-family="Arial, sans-serif" font-size="26" font-weight="bold" fill="${currentColor}" text-anchor="end" dominant-baseline="middle" filter="url(#shadow)">${headerArrow}</text>
			
			<!-- Time range indicator with better contrast -->
			<text x="${this.WIDTH - 4}" y="${this.HEIGHT - 4}" font-family="Arial, sans-serif" font-size="11" font-weight="600" fill="#666666" text-anchor="end" dominant-baseline="bottom" filter="url(#shadow)">${timeRangeLabel}</text>
		</svg>`;
	}
}
