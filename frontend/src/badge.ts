/** The same flat badge the server draws (relay/api.py badge_svg), for the demo. */
export function badgeSvg(label: string, value: string, color: string) {
  const lw = Math.floor(label.length * 6.5) + 12, vw = Math.floor(value.length * 6.5) + 12, w = lw + vw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${label}: ${value}"><title>${label}: ${value}</title><clipPath id="r"><rect width="${w}" height="20" rx="3"/></clipPath><g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#33383e"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11"><text x="${lw / 2}" y="14">${label}</text><text x="${lw + vw / 2}" y="14">${value}</text></g></svg>`;
}
