/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from '../../../../../base/browser/dom.js';
import { localize } from '../../../../../nls.js';
import { asCssVariable } from '../../../../../platform/theme/common/colorUtils.js';
import { chartsBlue, chartsForeground, chartsLines } from '../../../../../platform/theme/common/colorRegistry.js';

export interface ISessionData {
	startTime: number;
	typedCharacters: number;
	aiCharacters: number;
	acceptedInlineSuggestions: number | undefined;
	chatEditCount: number | undefined;
}

export interface IDailyAggregate {
	date: string; // ISO date string (YYYY-MM-DD)
	displayDate: string; // Formatted for display
	aiRate: number;
	totalAiChars: number;
	totalTypedChars: number;
	inlineSuggestions: number;
	chatEdits: number;
	sessionCount: number;
}

export type ChartViewMode = 'days' | 'sessions';

export function aggregateSessionsByDay(sessions: readonly ISessionData[]): IDailyAggregate[] {
	const dayMap = new Map<string, IDailyAggregate>();

	for (const session of sessions) {
		const date = new Date(session.startTime);
		const isoDate = date.toISOString().split('T')[0];
		const displayDate = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

		let aggregate = dayMap.get(isoDate);
		if (!aggregate) {
			aggregate = {
				date: isoDate,
				displayDate,
				aiRate: 0,
				totalAiChars: 0,
				totalTypedChars: 0,
				inlineSuggestions: 0,
				chatEdits: 0,
				sessionCount: 0,
			};
			dayMap.set(isoDate, aggregate);
		}

		aggregate.totalAiChars += session.aiCharacters;
		aggregate.totalTypedChars += session.typedCharacters;
		aggregate.inlineSuggestions += session.acceptedInlineSuggestions ?? 0;
		aggregate.chatEdits += session.chatEditCount ?? 0;
		aggregate.sessionCount += 1;
	}

	// Calculate AI rate for each day
	for (const aggregate of dayMap.values()) {
		const total = aggregate.totalAiChars + aggregate.totalTypedChars;
		aggregate.aiRate = total > 0 ? aggregate.totalAiChars / total : 0;
	}

	// Sort by date
	return Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export interface IAiStatsChartOptions {
	sessions: readonly ISessionData[];
	viewMode: ChartViewMode;
}

export function createAiStatsChart(
	options: IAiStatsChartOptions
): HTMLElement {
	const { sessions: sessionsData, viewMode: mode } = options;

	const width = 280;
	const height = 100;
	const margin = { top: 10, right: 10, bottom: 25, left: 30 };
	const innerWidth = width - margin.left - margin.right;
	const innerHeight = height - margin.top - margin.bottom;

	const container = $('.ai-stats-chart-container');
	container.style.position = 'relative';
	container.style.marginTop = '8px';

	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('width', `${width}px`);
	svg.setAttribute('height', `${height}px`);
	svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
	svg.style.display = 'block';
	container.appendChild(svg);

	const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
	g.setAttribute('transform', `translate(${margin.left},${margin.top})`);
	svg.appendChild(g);

	if (sessionsData.length === 0) {
		const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
		text.setAttribute('x', `${innerWidth / 2}`);
		text.setAttribute('y', `${innerHeight / 2}`);
		text.setAttribute('text-anchor', 'middle');
		text.setAttribute('fill', asCssVariable(chartsForeground));
		text.setAttribute('font-size', '11px');
		text.textContent = localize('noData', "No data yet");
		g.appendChild(text);
		return container;
	}

	// Draw axes
	const xAxisLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
	xAxisLine.setAttribute('x1', '0');
	xAxisLine.setAttribute('y1', `${innerHeight}`);
	xAxisLine.setAttribute('x2', `${innerWidth}`);
	xAxisLine.setAttribute('y2', `${innerHeight}`);
	xAxisLine.setAttribute('stroke', asCssVariable(chartsLines));
	xAxisLine.setAttribute('stroke-width', '1px');
	g.appendChild(xAxisLine);

	const yAxisLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
	yAxisLine.setAttribute('x1', '0');
	yAxisLine.setAttribute('y1', '0');
	yAxisLine.setAttribute('x2', '0');
	yAxisLine.setAttribute('y2', `${innerHeight}`);
	yAxisLine.setAttribute('stroke', asCssVariable(chartsLines));
	yAxisLine.setAttribute('stroke-width', '1px');
	g.appendChild(yAxisLine);

	// Y-axis labels (0%, 50%, 100%)
	for (const pct of [0, 50, 100]) {
		const y = innerHeight - (pct / 100) * innerHeight;
		const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
		label.setAttribute('x', '-4');
		label.setAttribute('y', `${y + 3}`);
		label.setAttribute('text-anchor', 'end');
		label.setAttribute('fill', asCssVariable(chartsForeground));
		label.setAttribute('font-size', '9px');
		label.textContent = `${pct}%`;
		g.appendChild(label);

		if (pct > 0) {
			const gridLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
			gridLine.setAttribute('x1', '0');
			gridLine.setAttribute('y1', `${y}`);
			gridLine.setAttribute('x2', `${innerWidth}`);
			gridLine.setAttribute('y2', `${y}`);
			gridLine.setAttribute('stroke', asCssVariable(chartsLines));
			gridLine.setAttribute('stroke-width', '0.5px');
			gridLine.setAttribute('stroke-dasharray', '2,2');
			g.appendChild(gridLine);
		}
	}

	if (mode === 'days') {
		renderDaysView();
	} else {
		renderSessionsView();
	}

	function renderDaysView() {
		const dailyData = aggregateSessionsByDay(sessionsData);
		const n = dailyData.length;

		const xFor = (i: number) => n === 1 ? innerWidth / 2 : i / (n - 1) * innerWidth;

		// Draw line
		const points = dailyData.map((day, i) => `${xFor(i)},${innerHeight - day.aiRate * innerHeight}`).join(' ');
		const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
		polyline.setAttribute('points', points);
		polyline.setAttribute('fill', 'none');
		polyline.setAttribute('stroke', asCssVariable(chartsBlue));
		polyline.setAttribute('stroke-width', '2');
		polyline.setAttribute('stroke-linejoin', 'round');
		polyline.setAttribute('stroke-linecap', 'round');
		g.appendChild(polyline);

		// Draw dots
		dailyData.forEach((day, i) => {
			const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
			circle.setAttribute('cx', `${xFor(i)}`);
			circle.setAttribute('cy', `${innerHeight - day.aiRate * innerHeight}`);
			circle.setAttribute('r', '2.5');
			circle.setAttribute('fill', asCssVariable(chartsBlue));
			g.appendChild(circle);
		});

		// X-axis labels
		const minLabelSpacing = 40;
		const maxLabels = Math.max(2, Math.floor(innerWidth / minLabelSpacing));
		const labelStep = Math.max(1, Math.ceil(n / maxLabels));

		dailyData.forEach((day, i) => {
			const x = xFor(i);
			const isFirst = i === 0;
			const isLast = i === n - 1;
			const isAtInterval = i % labelStep === 0;

			if (isFirst || isLast || (isAtInterval && n > 2)) {
				if (!isFirst && !isLast) {
					if (x - xFor(0) < minLabelSpacing || xFor(n - 1) - x < minLabelSpacing) {
						return;
					}
				}

				const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
				label.setAttribute('x', `${x}`);
				label.setAttribute('y', `${innerHeight + 12}`);
				label.setAttribute('text-anchor', 'middle');
				label.setAttribute('fill', asCssVariable(chartsForeground));
				label.setAttribute('font-size', '8px');
				label.textContent = day.displayDate;
				g.appendChild(label);
			}
		});
	}

	function renderSessionsView() {
		const n = sessionsData.length;

		const xFor = (i: number) => n === 1 ? innerWidth / 2 : i / (n - 1) * innerWidth;
		const rateFor = (session: ISessionData) => {
			const total = session.aiCharacters + session.typedCharacters;
			return total > 0 ? session.aiCharacters / total : 0;
		};

		// Draw line
		const points = sessionsData.map((session, i) => `${xFor(i)},${innerHeight - rateFor(session) * innerHeight}`).join(' ');
		const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
		polyline.setAttribute('points', points);
		polyline.setAttribute('fill', 'none');
		polyline.setAttribute('stroke', asCssVariable(chartsBlue));
		polyline.setAttribute('stroke-width', '2');
		polyline.setAttribute('stroke-linejoin', 'round');
		polyline.setAttribute('stroke-linecap', 'round');
		g.appendChild(polyline);

		// Draw dots (only if sessions are few enough to be visible)
		if (n <= 30) {
			sessionsData.forEach((session, i) => {
				const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
				circle.setAttribute('cx', `${xFor(i)}`);
				circle.setAttribute('cy', `${innerHeight - rateFor(session) * innerHeight}`);
				circle.setAttribute('r', '2');
				circle.setAttribute('fill', asCssVariable(chartsBlue));
				g.appendChild(circle);
			});
		}

		// X-axis labels: only show first and last
		const firstDate = new Date(sessionsData[0].startTime);
		const firstLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
		firstLabel.setAttribute('x', `${xFor(0)}`);
		firstLabel.setAttribute('y', `${innerHeight + 12}`);
		firstLabel.setAttribute('text-anchor', 'start');
		firstLabel.setAttribute('fill', asCssVariable(chartsForeground));
		firstLabel.setAttribute('font-size', '8px');
		firstLabel.textContent = firstDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
		g.appendChild(firstLabel);

		if (n > 1) {
			const lastDate = new Date(sessionsData[n - 1].startTime);
			const lastLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
			lastLabel.setAttribute('x', `${xFor(n - 1)}`);
			lastLabel.setAttribute('y', `${innerHeight + 12}`);
			lastLabel.setAttribute('text-anchor', 'end');
			lastLabel.setAttribute('fill', asCssVariable(chartsForeground));
			lastLabel.setAttribute('font-size', '8px');
			lastLabel.textContent = lastDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
			g.appendChild(lastLabel);
		}
	}

	return container;
}
