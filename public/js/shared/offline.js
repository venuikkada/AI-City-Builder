// Offline stand-in for the AI. Used when no Anthropic API key is configured,
// when the AI call fails, or when the game is hosted without a server. It reads
// the player's description with simple keyword rules and fills templates, so
// "Build a futuristic Hyderabad" still produces a themed, playable plan.

import { hashString, Rng } from './rng.js';
import { ARCHETYPES, THEMED_ARCHETYPES, nextMilestone } from './catalog.js';
import { sanitizePlan, sanitizeMissionBatch, sanitizeBuildingIdea, cleanText } from './plan.js';

const STYLE_KEYWORDS = [
  ['cyberpunk', /cyber ?punk|neon|dystop|noir|blade ?runner/],
  ['futuristic', /futur|20[5-9]\d|2[1-9]\d\d|sci-?fi|smart city|hyperloop|robot|space|tomorrow|quantum|flying|high-?tech|\bneo\b/],
  ['green', /green|eco|sustainab|garden|forest|solar|car-?free|carbon|nature|bicycle|bike|clean energy|zero.?waste/],
  ['heritage', /heritage|histor|\bold\b|ancient|royal|palace|fort|medieval|tradition|temple|nizam|mughal/],
  ['coastal', /coast|beach|\bsea\b|ocean|harbou?r|\bport\b|island|\bbay\b|marina|seaside/],
  ['desert', /desert|dune|oasis|\bsand|arid|mirage/],
];

const CITY_FLAVORS = {
  hyderabad: {
    display: 'Hyderabad', water: 'lake', currency: '₹', style: 'futuristic',
    districts: ['Cyberabad', 'Gachibowli', 'HITEC City', 'Banjara Hills', 'Charminar', 'Jubilee Hills'],
    landmarks: [
      { base: 'Charminar Bazaar Square', future: 'Charminar Holo-Arch', icon: '🕌', effect: 'tourism', unlock: 1000,
        description: 'The 1591 icon reborn in light — four minarets projecting the city skyline into the night sky.' },
      { base: 'Hussain Sagar Buddha Isle', future: 'Hussain Sagar Sky Isle', icon: '🏝️', effect: 'green', unlock: 5000,
        description: 'A solar-lit island park floating on Hussain Sagar, cooling the whole city.' },
      { base: 'Golconda Fort Gardens', future: 'Golconda Quantum Fort', icon: '🏰', effect: 'tech', unlock: 12000,
        description: 'The diamond fort of the Deccan, now a quantum computing citadel.' },
    ],
    highway: 'Outer Ring Road Hyperway',
  },
  mumbai: {
    display: 'Mumbai', water: 'coast', currency: '₹', style: 'coastal',
    districts: ['Bandra', 'Lower Parel', 'BKC', 'Colaba', 'Andheri', 'Worli'],
    landmarks: [
      { base: 'Gateway of India', future: 'Gateway of India Skyport', icon: '🏛️', effect: 'tourism', unlock: 1000 },
      { base: 'Marine Drive Promenade', future: 'Queen’s Necklace Lightway', icon: '🌃', effect: 'happiness', unlock: 5000 },
      { base: 'Sea Link Transit Hub', future: 'Sea Link Hyperloop Hub', icon: '🌉', effect: 'transit', unlock: 12000 },
    ],
    highway: 'Western Express Highway',
  },
  bengaluru: {
    display: 'Bengaluru', water: 'lake', currency: '₹', style: 'green',
    districts: ['Koramangala', 'Indiranagar', 'Whitefield', 'Electronic City', 'Jayanagar', 'Malleswaram'],
    landmarks: [
      { base: 'Lalbagh Glasshouse', future: 'Lalbagh Bio-Dome', icon: '🌺', effect: 'green', unlock: 1000 },
      { base: 'Cubbon Park Pavilion', future: 'Cubbon Sky Forest', icon: '🌳', effect: 'happiness', unlock: 5000 },
      { base: 'Electronic City Campus', future: 'Silicon Plateau Spire', icon: '💾', effect: 'tech', unlock: 12000 },
    ],
    highway: 'Outer Ring Road',
  },
  delhi: {
    display: 'Delhi', water: 'river', currency: '₹', style: 'heritage',
    districts: ['Connaught Place', 'Chandni Chowk', 'Hauz Khas', 'Dwarka', 'Saket', 'Lodhi'],
    landmarks: [
      { base: 'India Gate Lawns', future: 'India Gate Light Arch', icon: '🏛️', effect: 'happiness', unlock: 1000 },
      { base: 'Chandni Chowk Grand Bazaar', future: 'Chandni Chowk Holo-Bazaar', icon: '🏮', effect: 'tourism', unlock: 5000 },
      { base: 'Yamuna Riverfront', future: 'Yamuna Sky Gardens', icon: '🌊', effect: 'green', unlock: 12000 },
    ],
    highway: 'Ring Road',
  },
  chennai: {
    display: 'Chennai', water: 'coast', currency: '₹', style: 'coastal',
    districts: ['Marina', 'T. Nagar', 'Adyar', 'Mylapore', 'Guindy', 'Besant Nagar'],
    landmarks: [
      { base: 'Marina Beach Promenade', future: 'Marina Solar Promenade', icon: '🏖️', effect: 'happiness', unlock: 1000 },
      { base: 'Kapaleeshwarar Temple Square', future: 'Mylapore Heritage Dome', icon: '🛕', effect: 'tourism', unlock: 5000 },
      { base: 'Guindy Tech Corridor', future: 'Guindy Quantum Corridor', icon: '🛰️', effect: 'tech', unlock: 12000 },
    ],
    highway: 'East Coast Road',
  },
  kolkata: {
    display: 'Kolkata', water: 'river', currency: '₹', style: 'heritage',
    districts: ['Park Street', 'Salt Lake', 'Howrah', 'New Town', 'Ballygunge', 'Esplanade'],
    landmarks: [
      { base: 'Victoria Memorial Gardens', future: 'Victoria Light Memorial', icon: '🏛️', effect: 'tourism', unlock: 1000 },
      { base: 'Howrah Bridge Plaza', future: 'Howrah Maglev Bridge', icon: '🌉', effect: 'transit', unlock: 5000 },
      { base: 'Maidan Commons', future: 'Maidan Sky Commons', icon: '🌳', effect: 'green', unlock: 12000 },
    ],
    highway: 'EM Bypass',
  },
  pune: {
    display: 'Pune', water: 'river', currency: '₹', style: 'green',
    districts: ['Koregaon Park', 'Hinjewadi', 'Kothrud', 'Baner', 'Shivajinagar', 'Viman Nagar'],
    landmarks: [
      { base: 'Shaniwar Wada Square', future: 'Shaniwar Wada Light Fort', icon: '🏯', effect: 'tourism', unlock: 1000 },
      { base: 'Hinjewadi Tech Commons', future: 'Hinjewadi Quantum Park', icon: '💻', effect: 'tech', unlock: 5000 },
      { base: 'Sinhagad Hill Gardens', future: 'Sinhagad Sky Gardens', icon: '⛰️', effect: 'green', unlock: 12000 },
    ],
    highway: 'Mumbai–Pune Expressway',
  },
  jaipur: {
    display: 'Jaipur', water: 'lake', currency: '₹', style: 'heritage',
    districts: ['Pink City', 'Amer', 'Malviya Nagar', 'C-Scheme', 'Vaishali Nagar', 'Johari Bazaar'],
    landmarks: [
      { base: 'Hawa Mahal Square', future: 'Hawa Mahal Wind Tower', icon: '🏯', effect: 'tourism', unlock: 1000 },
      { base: 'Jal Mahal Lake Palace', future: 'Jal Mahal Floating Palace', icon: '🏝️', effect: 'happiness', unlock: 5000 },
      { base: 'Amer Fort Gardens', future: 'Amer Solar Citadel', icon: '🏰', effect: 'green', unlock: 12000 },
    ],
    highway: 'Ajmer Road Expressway',
  },
  dubai: {
    display: 'Dubai', water: 'coast', currency: 'AED', style: 'desert',
    districts: ['Marina', 'Downtown', 'Deira', 'Jumeirah', 'Business Bay', 'Al Barsha'],
    landmarks: [
      { base: 'Creek Souk', future: 'Creek Holo-Souk', icon: '🏮', effect: 'tourism', unlock: 1000 },
      { base: 'Palm Island Resort', future: 'Palm Sky Resort', icon: '🌴', effect: 'happiness', unlock: 5000 },
      { base: 'Desert Solar Spire', future: 'Mirage Quantum Spire', icon: '🗼', effect: 'tech', unlock: 12000 },
    ],
    highway: 'Sheikh Zayed Road',
  },
  singapore: {
    display: 'Singapore', water: 'coast', currency: 'S$', style: 'green',
    districts: ['Marina Bay', 'Orchard', 'Tanjong Pagar', 'Jurong', 'Bugis', 'Tampines'],
    landmarks: [
      { base: 'Garden Supertrees', future: 'Supertree Sky Grove', icon: '🌳', effect: 'green', unlock: 1000 },
      { base: 'Marina Bay Skypark', future: 'Marina Bay Orbital Park', icon: '🏙️', effect: 'tourism', unlock: 5000 },
      { base: 'Jurong Innovation Hub', future: 'Jurong Quantum Hub', icon: '🔬', effect: 'tech', unlock: 12000 },
    ],
    highway: 'East Coast Parkway',
  },
  tokyo: {
    display: 'Tokyo', water: 'coast', currency: '¥', style: 'cyberpunk',
    districts: ['Shibuya', 'Shinjuku', 'Akihabara', 'Ginza', 'Odaiba', 'Asakusa'],
    landmarks: [
      { base: 'Shibuya Crossing', future: 'Shibuya Holo-Crossing', icon: '🚦', effect: 'transit', unlock: 1000 },
      { base: 'Senso-ji Gardens', future: 'Asakusa Neon Temple', icon: '⛩️', effect: 'tourism', unlock: 5000 },
      { base: 'Sky Tree Tower', future: 'Sky Tree Orbital Tower', icon: '🗼', effect: 'happiness', unlock: 12000 },
    ],
    highway: 'Shuto Expressway',
  },
  'new york': {
    display: 'New York', water: 'river', currency: '$', style: 'classic',
    districts: ['Manhattan', 'Brooklyn', 'Harlem', 'SoHo', 'Queens', 'Midtown'],
    landmarks: [
      { base: 'Central Park Commons', future: 'Central Sky Park', icon: '🌳', effect: 'happiness', unlock: 1000 },
      { base: 'Liberty Harbor', future: 'Liberty Light Harbor', icon: '🗽', effect: 'tourism', unlock: 5000 },
      { base: 'Grand Central Hub', future: 'Grand Central Hyperloop', icon: '🚉', effect: 'transit', unlock: 12000 },
    ],
    highway: 'FDR Drive',
  },
  london: {
    display: 'London', water: 'river', currency: '£', style: 'heritage',
    districts: ['Camden', 'Shoreditch', 'Westminster', 'Canary Wharf', 'Soho', 'Greenwich'],
    landmarks: [
      { base: 'Thames Clock Tower', future: 'Thames Light Tower', icon: '🕰️', effect: 'tourism', unlock: 1000 },
      { base: 'Royal Park Gardens', future: 'Royal Sky Gardens', icon: '🌳', effect: 'green', unlock: 5000 },
      { base: 'Canary Wharf Exchange', future: 'Canary Quantum Exchange', icon: '🏦', effect: 'tech', unlock: 12000 },
    ],
    highway: 'North Circular',
  },
  paris: {
    display: 'Paris', water: 'river', currency: '€', style: 'heritage',
    districts: ['Montmartre', 'Le Marais', 'La Défense', 'Belleville', 'Bastille', 'Latin Quarter'],
    landmarks: [
      { base: 'Iron Lattice Tower', future: 'Lumière Sky Tower', icon: '🗼', effect: 'tourism', unlock: 1000 },
      { base: 'Seine Riverside Gardens', future: 'Seine Floating Gardens', icon: '🌷', effect: 'green', unlock: 5000 },
      { base: 'Grand Arch Plaza', future: 'Grand Arch Transit Hub', icon: '🏛️', effect: 'transit', unlock: 12000 },
    ],
    highway: 'Boulevard Périphérique',
  },
  amsterdam: {
    display: 'Amsterdam', water: 'river', currency: '€', style: 'green',
    districts: ['Jordaan', 'De Pijp', 'Zuidas', 'Oost', 'Noord', 'Centrum'],
    landmarks: [
      { base: 'Canal Ring Square', future: 'Canal Ring Light Square', icon: '🚲', effect: 'transit', unlock: 1000 },
      { base: 'Tulip Gardens', future: 'Tulip Sky Gardens', icon: '🌷', effect: 'green', unlock: 5000 },
      { base: 'Harbour Museum', future: 'Harbour Holo-Museum', icon: '🖼️', effect: 'tourism', unlock: 12000 },
    ],
    highway: 'A10 Ring',
  },
};

const CITY_ALIASES = {
  hyderabad: 'hyderabad', cyberabad: 'hyderabad', secunderabad: 'hyderabad',
  mumbai: 'mumbai', bombay: 'mumbai',
  bengaluru: 'bengaluru', bangalore: 'bengaluru',
  delhi: 'delhi', 'new delhi': 'delhi',
  chennai: 'chennai', madras: 'chennai',
  kolkata: 'kolkata', calcutta: 'kolkata',
  pune: 'pune', jaipur: 'jaipur', dubai: 'dubai', singapore: 'singapore', tokyo: 'tokyo',
  'new york': 'new york', nyc: 'new york', london: 'london', paris: 'paris', amsterdam: 'amsterdam',
};

const STYLE_NAMES = {
  futuristic: {
    road: 'Smart Street', avenue: 'Maglev Boulevard', house: 'Smart Villas', apartment: 'Vertical Garden Flats',
    tower: 'Sky Residences', shop: 'Holo-Market', office: 'Data Towers', factory: 'Robo-Foundry',
    techpark: 'Quantum Campus', school: 'Future Academy', hospital: 'Nano-Med Centre', police: 'Drone Patrol Hub',
    park: 'Bio-Dome Park', plaza: 'Hologram Plaza', bus: 'E-Pod Stop', metro: 'Hyperloop Station',
  },
  cyberpunk: {
    road: 'Neon Alley', avenue: 'Chrome Boulevard', house: 'Capsule Homes', apartment: 'Stack Blocks',
    tower: 'Arcology Spire', shop: 'Night Market', office: 'Corp Tower', factory: 'Synth Works',
    techpark: 'Netrunner Hub', school: 'Code Dojo', hospital: 'Cyber Clinic', police: 'Enforcer Precinct',
    park: 'Rooftop Garden', plaza: 'Neon Plaza', bus: 'Hover-Bus Stop', metro: 'Mag-Rail Station',
  },
  green: {
    road: 'Leafy Lane', avenue: 'Green Boulevard', house: 'Eco Cottages', apartment: 'Living-Wall Flats',
    tower: 'Forest Tower', shop: 'Farmers Market', office: 'Solar Offices', factory: 'Recycling Works',
    techpark: 'CleanTech Campus', school: 'Nature School', hospital: 'Wellness Centre', police: 'Community Watch',
    park: 'Pocket Forest', plaza: 'Garden Square', bus: 'E-Bus Stop', metro: 'Light Rail Station',
  },
  heritage: {
    road: 'Old Lane', avenue: 'Royal Avenue', house: 'Courtyard Homes', apartment: 'Haveli Apartments',
    tower: 'Heritage Towers', shop: 'Bazaar Stalls', office: 'Trading House', factory: 'Artisan Workshops',
    techpark: 'Innovation Palace', school: 'Grand Academy', hospital: 'Healing House', police: 'Watch House',
    park: 'Palace Garden', plaza: 'Clock Tower Square', bus: 'Tram Stop', metro: 'Heritage Rail Station',
  },
  coastal: {
    road: 'Seaside Lane', avenue: 'Marine Drive', house: 'Beach Cottages', apartment: 'Harbour Flats',
    tower: 'Ocean View Towers', shop: 'Fish Market', office: 'Port Offices', factory: 'Shipyard',
    techpark: 'Blue Economy Campus', school: 'Maritime School', hospital: 'Coastal Hospital', police: 'Coast Guard Post',
    park: 'Mangrove Park', plaza: 'Lighthouse Plaza', bus: 'Ferry Shuttle Stop', metro: 'Waterfront Metro',
  },
  desert: {
    road: 'Sandstone Street', avenue: 'Palm Boulevard', house: 'Courtyard Villas', apartment: 'Wind-Tower Flats',
    tower: 'Mirage Towers', shop: 'Souk Stalls', office: 'Oasis Offices', factory: 'Solar Glassworks',
    techpark: 'Sun Valley Campus', school: 'Star Academy', hospital: 'Oasis Clinic', police: 'Dune Patrol',
    park: 'Oasis Garden', plaza: 'Fountain Square', bus: 'Shaded Bus Stop', metro: 'Cool-Tunnel Metro',
  },
  classic: {
    road: 'Main Street', avenue: 'Grand Avenue', house: 'Family Homes', apartment: 'Apartments',
    tower: 'High-Rise Towers', shop: 'Corner Shops', office: 'Office Block', factory: 'Factory',
    techpark: 'Tech Park', school: 'Public School', hospital: 'General Hospital', police: 'Police Station',
    park: 'Neighbourhood Park', plaza: 'Town Square', bus: 'Bus Stop', metro: 'Metro Station',
  },
};

const STYLE_ICONS = {
  futuristic: { metro: '🚄', park: '🌐', shop: '🛍️', police: '🛸' },
  cyberpunk: { shop: '🏮', metro: '🚝', park: '🪴', police: '🚨' },
  green: { park: '🌲', house: '🛖', factory: '♻️', bus: '🚎' },
  heritage: { house: '🏘️', park: '🌷', plaza: '🕰️', bus: '🚋' },
  coastal: { shop: '🐟', park: '🌴', factory: '⚓', bus: '⛴️' },
  desert: { park: '🌴', shop: '🏺', factory: '☀️', tower: '🌇' },
  classic: {},
};

const STYLE_TEXT = {
  futuristic: {
    cityForms: ['Neo {city}', '{city} 2080', '{city} Prime'],
    tagline: 'Where {flavor} meets tomorrow.',
    vision: 'A gleaming smart city of maglev avenues, vertical gardens and quantum campuses, where {city} keeps its soul while racing into the future.',
    advisor: 'ARIA',
    generic: ['Nova Prime', 'Aurora Heights', 'Helios City', 'Zenith Bay'],
  },
  cyberpunk: {
    cityForms: ['{city} 2099', 'Neon {city}', '{city} Sprawl'],
    tagline: 'Neon never sleeps in {flavor}.',
    vision: 'A rain-slicked neon megacity of stacked homes, night markets and chrome boulevards — dazzling, dense and always awake.',
    advisor: 'GHOST',
    generic: ['Neon Sprawl', 'Chrome Harbor', 'Night City Nine', 'Glitchport'],
  },
  green: {
    cityForms: ['Green {city}', '{city} Garden City', 'Eco {city}'],
    tagline: '{flavor}, grown green.',
    vision: 'A leafy, low-carbon city of pocket forests, light rail and solar rooftops where every home is a short walk from a park.',
    advisor: 'Dr. Leaf',
    generic: ['Verdant Vale', 'Leafhaven', 'Solaria Gardens', 'Willowmere'],
  },
  heritage: {
    cityForms: ['Royal {city}', '{city} Reborn', 'Old {city}'],
    tagline: 'The grandeur of {flavor}, lovingly restored.',
    vision: 'A city of courtyards, bazaars and grand avenues where heritage streets meet modern comforts.',
    advisor: 'The Royal Planner',
    generic: ['Old Crown', 'Kingsbridge', 'Ambergate', 'Sultanpur'],
  },
  coastal: {
    cityForms: ['{city} Bay', 'Port {city}', '{city} Harbour'],
    tagline: 'Sea breeze and skyline — welcome to {flavor}.',
    vision: 'A breezy waterfront city of promenades, harbour flats and ferries, where the sea shapes every street.',
    advisor: 'Captain Marin',
    generic: ['Coral Bay', 'Port Azure', 'Seabright', 'Harbourlight'],
  },
  desert: {
    cityForms: ['{city} Oasis', 'Sun {city}', '{city} Mirage'],
    tagline: 'An oasis of ambition rising from the sands of {flavor}.',
    vision: 'A shaded, solar-powered desert city of wind towers, souks and palm boulevards.',
    advisor: 'Sahar',
    generic: ['Mirage Wells', 'Sunspire', 'Dune Haven', 'Amber Oasis'],
  },
  classic: {
    cityForms: ['{city}', 'Greater {city}', '{city} City'],
    tagline: '{flavor}: built your way.',
    vision: 'A lively, well-planned city with busy streets, friendly neighbourhoods and room to grow.',
    advisor: 'Deputy Mayor Sam',
    generic: ['Maplewood', 'Riverton', 'Fairhaven', 'Brookfield'],
  },
};

const GENERIC_LANDMARKS = {
  futuristic: [['Skyline Holo-Spire', '🗼', 'tourism'], ['Orbital Garden Ring', '🪐', 'green'], ['Quantum Research Citadel', '🧬', 'tech']],
  cyberpunk: [['Neon Megatower', '🌃', 'tourism'], ['Arcade Arcology', '🕹️', 'happiness'], ['Data Fortress', '💽', 'tech']],
  green: [['Great Solar Canopy', '🌞', 'green'], ['Wildflower Commons', '🌻', 'happiness'], ['Bamboo Transit Hub', '🎋', 'transit']],
  heritage: [['Grand Clock Tower', '🕰️', 'tourism'], ['Palace Gardens', '🏯', 'happiness'], ['Old Town Rail Hall', '🚂', 'transit']],
  coastal: [['Lighthouse Point', '🗼', 'tourism'], ['Coral Reef Park', '🐠', 'green'], ['Harbour Ferry Terminal', '⛴️', 'transit']],
  desert: [['Sunstone Spire', '🌇', 'tourism'], ['Oasis Water Gardens', '💧', 'green'], ['Solar Research Dome', '🔆', 'tech']],
  classic: [['City Hall Tower', '🏛️', 'tourism'], ['Grand Central Park', '🌳', 'happiness'], ['Union Station', '🚉', 'transit']],
};

const STYLE_EVENTS = {
  futuristic: [['Drone Light Show', 'happiness_boost'], ['Tech Summit', 'growth_boost'], ['Solar Flare Outage', 'money_cost']],
  cyberpunk: [['Neon Festival', 'happiness_boost'], ['Crypto Windfall', 'money_bonus'], ['Grid Hack', 'money_cost']],
  green: [['Tree Planting Day', 'happiness_boost'], ['Green Energy Grant', 'money_bonus'], ['Pollen Storm', 'happiness_drop']],
  heritage: [['Heritage Festival', 'happiness_boost'], ['Tourist Season', 'money_bonus'], ['Old Pipes Burst', 'money_cost']],
  coastal: [['Regatta Week', 'happiness_boost'], ['Cruise Ship Arrives', 'money_bonus'], ['Storm Surge', 'money_cost']],
  desert: [['Star Gazing Night', 'happiness_boost'], ['Solar Export Deal', 'money_bonus'], ['Sandstorm', 'money_cost']],
  classic: [['Summer Fair', 'happiness_boost'], ['Business Grant', 'money_bonus'], ['Water Main Break', 'money_cost']],
};

const HYDERABAD_FUTURE = {
  names: {
    road: ['Cyberabad Smart Street', 'Self-cleaning smart streets lined with neem trees.'],
    avenue: ['Tank Bund Maglev Avenue', 'Wide maglev boulevards inspired by the Tank Bund promenade.'],
    house: ['Deccan Smart Villas', 'Solar-roofed family villas on the rocky Deccan plateau.'],
    apartment: ['Gachibowli Vertical Gardens', 'Mid-rise flats wrapped in hanging gardens.'],
    tower: ['Cyberabad Sky Residences', 'Glass towers with sky-bridges over the tech corridor.'],
    shop: ['Laad Bazaar Holo-Market', 'Bangles, pearls and biryani — now with holographic stalls.'],
    office: ['HITEC City Data Towers', 'Gleaming offices for the world’s biggest tech brands.'],
    factory: ['Genome Valley Bio-Foundry', 'Vaccine and biotech foundries. Keep them away from homes.'],
    techpark: ['Quantum HITEC Campus', 'Quantum computing campuses powering the Deccan cloud.'],
    school: ['Deccan Future Academy', 'AI-tutored classrooms for young innovators.'],
    hospital: ['Banjara Nano-Med Centre', 'Nano-medicine hospital with drone ambulances.'],
    police: ['Cyber Guardian Drone Hub', 'Drone patrols keeping every lane safe.'],
    park: ['Lumbini Bio-Dome Park', 'Cool green domes to beat the Deccan heat.'],
    plaza: ['Necklace Road Holo-Plaza', 'A lakeside plaza that sparkles like a pearl necklace.'],
    bus: ['Deccan E-Pod Stop', 'Driverless electric pods for short hops.'],
    metro: ['Hyderabad Hyperloop Metro', 'Hyperloop stations whisking commuters across the city.'],
  },
  tagline: 'Where the Deccan Plateau meets tomorrow.',
  vision: 'A glittering tech capital around a solar-lit Hussain Sagar: maglev avenues through HITEC City, vertical gardens in Gachibowli and a Charminar reborn in light — with the best biryani in the galaxy.',
  advisorName: 'Nizam-9',
  advisorIntro: 'Adaab, Mayor! I’m Nizam-9, your city AI. The Outer Ring Road Hyperway is ready — lay smart streets off it, settle the first families and let’s build the Hyderabad of 2080.',
  events: [
    ['Bonalu Festival of Lights', 'The whole city dances under drone-lit skies. Spirits soar!', 'happiness_boost'],
    ['Biryani Week', 'Food lovers pour in from across the galaxy for dum biryani.', 'money_bonus'],
    ['Monsoon Cloudburst', 'Flash floods on the plateau — repairs are needed.', 'money_cost'],
    ['HITEX Tech Summit', 'Global founders are scouting Hyderabad for new campuses.', 'growth_boost'],
    ['Cricket Final at Uppal', 'Everyone is driving to the stadium at once!', 'traffic_jam'],
  ],
  missions: [
    ['Welcome to {city}', 'Settle the first 300 Hyderabadis along the Hyperway.', 'population', 300],
    ['Cyberabad Jobs Boom', 'Create 400 jobs so the city can earn its keep.', 'jobs', 400],
    ['Green Deccan', 'Build 4 bio-dome parks to beat the heat.', 'build', 4, 'park'],
    ['Hyderabad Rising', 'Grow to 2,000 residents.', 'population', 2000],
    ['No More Hyperway Jams', 'Keep congestion under 40% with 2,000+ residents.', 'traffic_below', 40, 'none', 2000],
    ['Hyperloop to HITEC City', 'Open 2 hyperloop metro stations.', 'build', 2, 'metro'],
    ['Light Up the Charminar', 'Build your first landmark.', 'build', 1, 'landmark'],
    ['Global Tech Capital', 'Reach 12,000 residents.', 'population', 12000],
  ],
};

function titleCase(s) {
  return s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

/** The style whose keyword appears first wins: adjectives usually lead ("green car-free Amsterdam of 2080"). */
export function detectStyle(text, fallback = 'classic') {
  const t = text.toLowerCase();
  let best = fallback;
  let bestIndex = Infinity;
  for (const [style, re] of STYLE_KEYWORDS) {
    const m = re.exec(t);
    if (m && m.index < bestIndex) {
      best = style;
      bestIndex = m.index;
    }
  }
  return best;
}

export function detectCity(text) {
  const t = ` ${text.toLowerCase().replace(/[^a-z\s]/g, ' ')} `;
  for (const [alias, key] of Object.entries(CITY_ALIASES)) {
    if (t.includes(` ${alias} `)) return key;
  }
  return null;
}

const STOP_WORDS = new Set(
  'build make create design a an the my our of in on at by for with and to city town village metropolis futuristic modern green eco smart cyberpunk future old new ancient please i want like that where'.split(' '),
);

/** Best guess at a place name in a free-form prompt (e.g. "Build a solar Rivendell" → "Rivendell"). */
export function extractPlaceName(text) {
  const words = text.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean);
  const candidates = words.slice(1).filter((w) => /^\p{Lu}/u.test(w) && !STOP_WORDS.has(w.toLowerCase()) && w.length > 2);
  if (!candidates.length) return null;
  return cleanText(candidates.slice(0, 2).join(' '), 20, null);
}

function detectWater(text, style, flavor) {
  const t = text.toLowerCase();
  if (/\blake|lagoon|reservoir|sagar/.test(t)) return 'lake';
  if (/\briver|canal|delta/.test(t)) return 'river';
  if (/coast|beach|\bsea\b|ocean|harbou?r|\bport\b|island|\bbay\b/.test(t)) return 'coast';
  if (flavor) return flavor.water;
  if (style === 'coastal') return 'coast';
  if (style === 'desert') return 'none';
  if (style === 'green') return 'river';
  return 'lake';
}

function detectGreenery(text, style) {
  const t = text.toLowerCase();
  if (/forest|jungle|garden|leafy|green|park/.test(t) || style === 'green') return 'high';
  if (style === 'desert' || /desert|arid|concrete/.test(t)) return 'low';
  return 'medium';
}

function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

const LADDER = [
  ['First Neighbours', 'Settle the first families in {city}.', 'population', 300],
  ['Open for Business', 'Create places to work so residents can earn a living.', 'jobs', 250],
  ['Breathing Space', 'Plant parks so {city} stays pleasant as it grows.', 'build', 3, 'park'],
  ['{city} Rising', 'Grow into a bustling town of 1,500.', 'population', 1500],
  ['Smooth Commutes', 'Keep congestion under 40% with 1,500+ residents.', 'traffic_below', 40, 'none', 1500],
  ['Transit Pioneers', 'Open 4 bus stops so commuters can leave the car at home.', 'build', 4, 'bus'],
  ['A Symbol for {city}', 'Build your first landmark.', 'build', 1, 'landmark'],
  ['Metropolis', 'Reach 8,000 residents.', 'population', 8000],
];

function ladderToMissions(ladder, vars) {
  return ladder.map(([title, description, objective, target, archetype = 'none', minPopulation = 0], i) => ({
    id: `m${i + 1}`,
    title: fill(title, vars),
    description: fill(description, vars),
    objective,
    target,
    archetype,
    minPopulation,
  }));
}

/** Offline city plan for a free-form description. Deterministic per prompt. */
export function offlinePlan(prompt) {
  const text = String(prompt || '').slice(0, 300);
  const rng = new Rng(hashString(text.toLowerCase().trim() || 'city'));
  const cityKey = detectCity(text);
  const flavor = cityKey ? CITY_FLAVORS[cityKey] : null;
  const style = detectStyle(text, flavor?.style || 'classic');
  const styleText = STYLE_TEXT[style];
  const place = flavor?.display || extractPlaceName(text);
  const isFutureHyderabad = cityKey === 'hyderabad' && (style === 'futuristic' || style === 'cyberpunk');
  let cityName = place ? fill(rng.pick(styleText.cityForms), { city: place }) : rng.pick(styleText.generic);
  if (isFutureHyderabad) cityName = style === 'cyberpunk' ? 'Hyderabad 2099' : 'Neo Hyderabad';
  const displayPlace = place || cityName;
  const vars = { city: cityName, flavor: displayPlace };

  const names = {};
  for (const id of THEMED_ARCHETYPES) {
    names[id] = {
      name: STYLE_NAMES[style][id],
      description: ARCHETYPES[id].blurb,
      icon: STYLE_ICONS[style][id] || ARCHETYPES[id].icon,
    };
  }
  if (flavor) {
    const d = flavor.districts;
    names.apartment.name = `${d[1]} ${STYLE_NAMES[style].apartment}`;
    names.tower.name = `${d[0]} ${STYLE_NAMES[style].tower}`;
    names.office.name = `${d[2]} ${STYLE_NAMES[style].office}`;
    names.plaza.name = `${d[3]} ${STYLE_NAMES[style].plaza}`;
  }
  if (isFutureHyderabad) {
    for (const [id, [name, description]] of Object.entries(HYDERABAD_FUTURE.names)) {
      names[id] = { ...names[id], name, description };
    }
  }

  const futureish = style === 'futuristic' || style === 'cyberpunk';
  const landmarks = flavor
    ? flavor.landmarks.map((lm) => ({
        name: futureish ? lm.future : lm.base,
        description: lm.description || `${futureish ? lm.future : lm.base}: the pride of ${cityName}, drawing visitors from far and wide.`,
        icon: lm.icon,
        effect: lm.effect,
        unlockPopulation: lm.unlock,
      }))
    : GENERIC_LANDMARKS[style].map(([name, icon, effect], i) => ({
        name,
        description: `${name}: a one-of-a-kind icon for ${cityName}.`,
        icon,
        effect,
        unlockPopulation: [1000, 5000, 12000][i],
      }));

  const events = isFutureHyderabad
    ? HYDERABAD_FUTURE.events.map(([title, description, effect]) => ({ title, description, effect, magnitude: 2 }))
    : STYLE_EVENTS[style].map(([title, effect]) => ({
        title,
        description: `${title} in ${cityName}!`,
        effect,
        magnitude: rng.int(1, 2),
      }));

  const missions = isFutureHyderabad ? ladderToMissions(HYDERABAD_FUTURE.missions, vars) : ladderToMissions(LADDER, vars);
  if (!isFutureHyderabad && (style === 'futuristic' || style === 'cyberpunk')) {
    missions[5] = { ...missions[5], title: 'Hyper-Transit', description: 'Open 2 metro stations.', target: 2, archetype: 'metro' };
  }

  const raw = {
    cityName,
    tagline: isFutureHyderabad ? HYDERABAD_FUTURE.tagline : fill(styleText.tagline, vars),
    vision: isFutureHyderabad ? HYDERABAD_FUTURE.vision : fill(styleText.vision, { city: displayPlace }),
    style,
    currency: flavor?.currency || (/₹|rupee|india/i.test(text) ? '₹' : '$'),
    terrain: { water: detectWater(text, style, flavor), greenery: detectGreenery(text, style) },
    highwayName: flavor?.highway || (futureish ? 'Hyperway One' : 'Regional Highway'),
    names,
    landmarks,
    missions,
    events,
    advisorName: isFutureHyderabad ? HYDERABAD_FUTURE.advisorName : styleText.advisor,
    advisorIntro: isFutureHyderabad
      ? HYDERABAD_FUTURE.advisorIntro
      : `Welcome, Mayor of ${cityName}! I'm ${styleText.advisor}. Lay streets off the highway, settle a few homes, then add shops and factories so people have work.`,
    source: 'offline',
  };
  return sanitizePlan(raw, { prompt: text });
}

/** Offline "advisor" missions that react to the city's current weaknesses. */
export function offlineMissions(context) {
  const s = context?.stats || {};
  const counts = context?.counts || {};
  const pop = s.population || 0;
  const missions = [];
  const advice = [];
  const city = context?.cityName || 'the city';

  if (pop > 800 && s.congestion > 55) {
    missions.push({
      title: 'Break the Gridlock',
      description: `Bring congestion below ${Math.max(25, s.congestion - 20)}% with transit and parallel roads.`,
      objective: 'traffic_below', target: Math.max(25, s.congestion - 20), minPopulation: pop,
    });
    missions.push({
      title: 'Ride, Don’t Drive',
      description: 'Get more commuters onto buses and metro.',
      objective: 'transit_share', target: Math.min(60, Math.max(15, (s.transitShare || 0) + 12)), minPopulation: Math.max(500, Math.round(pop * 0.8)),
    });
    advice.push(`Traffic is choking ${city} at ${s.congestion}% congestion — add avenues, parallel streets and transit near homes and jobs.`);
  }
  if (pop > 300 && s.employment < 80) {
    missions.push({
      title: 'Jobs for Everyone',
      description: 'Build shops, offices and industry until 85% of workers have jobs.',
      objective: 'employment', target: 85, minPopulation: pop,
    });
    advice.push(`Only ${s.employment}% of workers have jobs. Zone more shops, offices or factories.`);
  }
  if (pop > 300 && s.happiness < 60) {
    missions.push({
      title: 'Happy Citizens',
      description: 'Parks, schools, hospitals and lower taxes cheer people up.',
      objective: 'happiness', target: Math.min(85, s.happiness + 12), minPopulation: Math.round(pop * 0.9),
    });
    advice.push(`Happiness is ${s.happiness}%. Parks, services and fair taxes will help.`);
  }
  if (s.net < 0) {
    missions.push({
      title: 'Balance the Books',
      description: 'Turn a monthly profit of at least 300.',
      objective: 'monthly_income', target: 300,
    });
    advice.push('The budget is in the red. Grow the tax base or trim expensive services.');
  }
  if (pop > 1000 && !counts.school) {
    missions.push({ title: 'Class in Session', description: 'Build a school for young families.', objective: 'build', target: 1, archetype: 'school' });
  }
  if (pop > 1500 && !counts.hospital) {
    missions.push({ title: 'Health First', description: 'Open a hospital.', objective: 'build', target: 1, archetype: 'hospital' });
  }
  const next = nextMilestone(pop);
  const growthTarget = next ? next.pop : Math.round(pop * 1.5);
  missions.push({
    title: next ? `Become a ${next.title}` : 'Keep Growing',
    description: `Grow ${city} to ${growthTarget.toLocaleString('en-US')} residents.`,
    objective: 'population', target: Math.max(growthTarget, pop + 200),
  });
  missions.push({
    title: 'Treasury Goals',
    description: 'Build up a healthy city treasury.',
    objective: 'money', target: Math.max(5000, Math.round(((s.money || 0) + 5000) / 1000) * 1000 * 2),
  });
  if (!advice.length) advice.push(`${city} is running smoothly. Keep growing and plan transit before traffic builds up.`);

  const active = new Set(context?.active || []);
  return sanitizeMissionBatch(
    { missions: missions.filter((m) => !active.has(m.title)).slice(0, 3), advice: advice.slice(0, 2).join(' ') },
    { landmarkCount: context?.landmarks?.length ?? 3 },
  );
}

const INVENT_RULES = [
  ['metro', /metro|train|hyperloop|rail|monorail|maglev|subway|tram/],
  ['bus', /bus|pod|shuttle|taxi|ferry|drone port|cable car|rickshaw|bike share/],
  ['hospital', /hospital|clinic|health|medical|doctor|wellness/],
  ['police', /police|security|guard|fire|patrol|rescue/],
  ['school', /school|college|university|academy|library|learning|museum/],
  ['techpark', /tech|lab|research|\bai\b|data|robot|quantum|campus|innovation|startup|space/],
  ['office', /office|bank|headquarter|\bhq\b|corporate|finance|exchange/],
  ['factory', /factory|plant|foundry|industr|warehouse|shipyard|workshop|mill/],
  ['tower', /tower|skyscraper|sky|high-?rise|arcology/],
  ['apartment', /apartment|flat|condo|housing|residenc|hostel/],
  ['house', /house|home|villa|cottage|bungalow|cabin/],
  ['plaza', /plaza|square|stadium|arena|promenade|fountain|amphitheat|fair|stage/],
  ['park', /park|garden|forest|green|lake|zoo|beach|playground|farm/],
  ['shop', /shop|market|mall|bazaar|store|cafe|restaurant|food|biryani|hotel|cinema|souk/],
];

const BONUS_RULES = [
  ['eco', /eco|solar|green|vertical garden|recycl|carbon|wind|clean/],
  ['smart', /smart|\bai\b|automat|robot|autonomous|app/],
  ['efficient', /efficient|cheap|budget|modular|prefab/],
  ['dense', /mega|giant|dense|huge|massive|vertical/],
  ['iconic', /iconic|landmark|grand|golden|glass|spectacular|floating|holo/],
];

/** Offline "invent a building": maps a free-form idea onto an archetype + bonus. */
export function offlineBuilding(prompt, plan) {
  const text = String(prompt || '').slice(0, 200);
  const t = text.toLowerCase();
  const archetype = INVENT_RULES.find(([, re]) => re.test(t))?.[0] || 'plaza';
  const bonus = BONUS_RULES.find(([, re]) => re.test(t))?.[0] || 'none';
  const name = titleCase(text.replace(/^(a|an|the|build|make|add)\s+/i, '').trim()) || 'Mystery Building';
  const cityName = plan?.cityName || 'the city';
  return sanitizeBuildingIdea({
    name,
    description: `Invented for ${cityName}. Works like a ${ARCHETYPES[archetype].noun}${bonus === 'none' ? '' : ` with the ${bonus} bonus`}.`,
    icon: ARCHETYPES[archetype].icon,
    archetype,
    bonus,
  });
}
