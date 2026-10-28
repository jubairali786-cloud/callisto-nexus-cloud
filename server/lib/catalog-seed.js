// Smart Service Catalog seed data: 13 categories, 124 items, covering the company's full
// scope of work (AC, electrical, plumbing, painting, carpentry, masonry & tiling, gypsum &
// false ceiling, civil & renovation, air duct cleaning, handyman, cleaning, fire protection,
// and general charges).
//
// Every item is seeded with sale_price = 0 — a deliberate, clearly-labelled UNPRICED
// PLACEHOLDER, never an approved selling price (see items table / UI: price 0.00 is always
// shown with an "unpriced — confirm before quoting" flag, enforced when adding a line to a
// quotation). VAT defaults to 5% (standard-rated UAE supply); change per item if a specific
// service needs a different tax treatment.
//
// Regulated activities (electrical, fire protection, etc.) remain subject to the company's
// own licences, authority approvals and qualified-personnel requirements — this catalog only
// describes the commercial line item, not a substitute for those requirements.

const CATEGORY_NOTES = {
  "AC Maintenance & Repair":
    "Scope includes inspection, cleaning, servicing and functional testing of the specified AC units. Spare parts, refrigerant, major repairs and additional works are excluded unless specifically included in this quotation.",
  "Electrical Works":
    "Scope includes the electrical installation, repair or maintenance activities described in this quotation. Additional wiring, materials, shutdown requirements and modifications outside the agreed scope will be quoted separately.",
  "Plumbing Works":
    "Scope includes the specified plumbing installation or repair. Concealed leaks, wall opening, waterproofing and reinstatement are excluded unless expressly included.",
  "Painting Works":
    "Scope includes surface preparation and painting of the specified areas using the agreed paint system. Major plaster repairs, moisture treatment and additional coats are excluded unless quoted.",
  "Carpentry Works":
    "Scope includes the specified carpentry supply, installation or repair works using the agreed materials and finish. Structural alterations, electrical/plumbing relocations and additional fittings are excluded unless included in this quotation.",
  "Masonry & Tiling":
    "Scope includes the specified masonry, plastering or tiling works using the agreed materials and finish. Substrate repairs, waterproofing membranes and additional works beyond the areas listed are excluded unless included in this quotation.",
  "Gypsum & False Ceiling":
    "Scope includes the specified gypsum partition or ceiling installation. Painting, lighting, insulation and additional finishing are excluded unless included in the quotation.",
  "Civil & Renovation Works":
    "Scope includes the civil, demolition or renovation works described in this quotation, carried out in accordance with the agreed drawings/specifications where applicable. Structural design, authority approvals, permits and works outside the listed scope are excluded unless expressly included.",
  "Air Duct Cleaning":
    "Scope includes mechanical cleaning and inspection of the specified ductwork/components to improve airflow and indoor air quality. Duct repair, insulation replacement and major component replacement are excluded unless included in this quotation.",
  "Handyman Services":
    "Scope covers minor repair and installation works as described in this quotation, completed during a single visit. Major repairs, specialised trade works and materials beyond those listed are excluded unless included.",
  "Cleaning Services":
    "Scope includes the cleaning activities described in this quotation using standard cleaning materials and equipment. Specialised treatments (e.g. pest control, mould remediation), upholstery/carpet shampooing and works beyond the areas listed are excluded unless included.",
  "Fire Protection & Fireproofing":
    "Scope includes application or installation of the specified fire protection materials in accordance with approved specifications, applicable manufacturer requirements and relevant authority conditions. Required approvals and inspections must be confirmed before execution.",
  "General Charges":
    "This is a supplementary charge related to the works described in this quotation (labour, materials, delivery, equipment or an approved variation) rather than a standalone service. Details and basis of charge are stated in the line description.",
};

// prefix: used to build the item_code, e.g. AC-001
const CATEGORIES = [
  { name: "AC Maintenance & Repair", prefix: "AC", items: [
    ["Split AC servicing", "unit", "Routine cleaning, filter wash and performance check of a single split AC unit."],
    ["Window AC servicing", "unit", "Routine cleaning, filter wash and performance check of a single window AC unit."],
    ["Ducted AC servicing", "unit", "Cleaning, filter check and performance servicing of a ducted (central) AC system."],
    ["Package AC servicing", "unit", "Cleaning, filter check and performance servicing of a packaged AC unit."],
    ["AC installation", "unit", "Supply and installation of a new AC unit, including standard mounting and connection."],
    ["AC dismantling and relocation", "unit", "Safe dismantling, transport and reinstallation of an existing AC unit at a new location."],
    ["AC refrigerant recharge", "unit", "Evacuation and recharge of refrigerant gas to manufacturer-specified levels."],
    ["AC gas leak repair", "unit", "Leak detection and repair of a refrigerant gas leak, followed by a recharge and performance check."],
    ["AC water leakage repair", "unit", "Diagnosis and repair of water leakage from an AC unit, including drain line clearing where required."],
    ["AC compressor replacement", "unit", "Supply and replacement of a faulty AC compressor, including recommissioning of the unit."],
    ["AC thermostat replacement", "unit", "Supply and replacement of a faulty AC thermostat or control unit."],
    ["AC filter cleaning", "unit", "Removal, cleaning and refitting of AC air filters."],
    ["Annual AC maintenance contract", "job", "Scheduled periodic servicing of AC units under an annual maintenance agreement, as specified in the agreed schedule."],
  ]},
  { name: "Electrical Works", prefix: "ELE", items: [
    ["Electrical fault finding", "job", "Diagnostic inspection to identify the cause of a reported electrical fault."],
    ["Electrical wiring installation", "job", "Installation of new electrical wiring in accordance with the agreed layout."],
    ["Socket installation and replacement", "unit", "Supply and installation or replacement of a power socket outlet."],
    ["Switch installation", "unit", "Supply and installation of a light or power switch."],
    ["LED lighting installation", "unit", "Supply and installation of LED light fittings."],
    ["Light fixture replacement", "unit", "Removal of an existing light fixture and installation of a replacement fixture."],
    ["Distribution board installation", "unit", "Supply and installation of an electrical distribution board."],
    ["MCB and RCCB replacement", "unit", "Supply and replacement of a faulty miniature circuit breaker (MCB) or residual current circuit breaker (RCCB)."],
    ["Cable laying and termination", "running metre", "Laying and termination of electrical cable along the agreed route."],
    ["Earthing works", "job", "Installation or inspection of an earthing/grounding system in accordance with applicable standards."],
    ["Electrical maintenance", "job", "General electrical maintenance visit covering the items described in this quotation."],
    ["Electrical fit-out", "job", "Complete electrical fit-out works for the specified space, as per the agreed scope."],
  ]},
  { name: "Plumbing Works", prefix: "PLB", items: [
    ["Water leakage repair", "job", "Diagnosis and repair of a reported water leak."],
    ["Water pipe installation", "running metre", "Supply and installation of new water supply piping."],
    ["Drainage pipe installation", "running metre", "Supply and installation of new drainage piping."],
    ["Drain blockage removal", "job", "Clearing of a blocked drain line using appropriate rodding/jetting equipment."],
    ["Water heater installation", "unit", "Supply and installation of a new water heater."],
    ["Water heater repair", "unit", "Diagnosis and repair of a faulty water heater."],
    ["Wash basin installation", "unit", "Supply and installation of a wash basin, including standard fittings."],
    ["Kitchen sink installation", "unit", "Supply and installation of a kitchen sink, including standard fittings."],
    ["WC installation and repair", "unit", "Supply and installation, or repair, of a WC (toilet) unit."],
    ["Tap and mixer replacement", "unit", "Supply and replacement of a tap or mixer fitting."],
    ["Water pump installation", "unit", "Supply and installation of a water pump."],
    ["Bathroom plumbing renovation", "job", "Renovation of bathroom plumbing fittings and pipework as described in this quotation."],
  ]},
  { name: "Painting Works", prefix: "PNT", items: [
    ["Interior wall painting", "m²", "Preparation and painting of interior wall surfaces with the agreed paint system."],
    ["Exterior wall painting", "m²", "Preparation and painting of exterior wall surfaces with a weather-resistant paint system."],
    ["Ceiling painting", "m²", "Preparation and painting of ceiling surfaces with the agreed paint system."],
    ["Villa painting", "job", "Complete interior and/or exterior painting of a villa, as described in this quotation."],
    ["Apartment painting", "job", "Complete interior painting of an apartment, as described in this quotation."],
    ["Office painting", "job", "Complete interior painting of an office space, as described in this quotation."],
    ["Wall crack filling", "running metre", "Filling and patching of wall cracks prior to painting."],
    ["Surface preparation and primer", "m²", "Surface preparation (sanding, filling, cleaning) and primer application prior to final painting."],
    ["Door and metal painting", "unit", "Preparation and painting of doors or metal surfaces/railings."],
    ["Decorative painting", "m²", "Application of a decorative paint finish or texture as specified."],
  ]},
  { name: "Carpentry Works", prefix: "CAR", items: [
    ["Wooden door installation", "unit", "Supply and installation of a wooden door, including standard hardware."],
    ["Door repair", "unit", "Repair of a damaged or malfunctioning door."],
    ["Door lock installation", "unit", "Supply and installation of a door lock."],
    ["Kitchen cabinet installation", "job", "Supply and installation of kitchen cabinetry as per the agreed design."],
    ["Cabinet repair", "unit", "Repair of damaged cabinetry."],
    ["Wardrobe installation", "unit", "Supply and installation of a wardrobe unit."],
    ["Wooden partition works", "m²", "Supply and installation of a wooden partition."],
    ["Wooden skirting installation", "running metre", "Supply and installation of wooden skirting."],
    ["Furniture repair", "unit", "Repair of damaged wooden furniture."],
    ["Custom carpentry works", "job", "Bespoke carpentry works carried out to the agreed specification."],
  ]},
  { name: "Masonry & Tiling", prefix: "MAS", items: [
    ["Block masonry", "m²", "Construction of block masonry walls to the specified dimensions."],
    ["Brickwork repair", "m²", "Repair of damaged brickwork."],
    ["Wall plastering", "m²", "Application of plaster finish to wall surfaces."],
    ["Floor tile installation", "m²", "Supply and installation of floor tiles."],
    ["Wall tile installation", "m²", "Supply and installation of wall tiles."],
    ["Tile replacement", "unit", "Removal and replacement of damaged tiles."],
    ["Tile grouting", "m²", "Grouting of tile joints."],
    ["Concrete patch repair", "job", "Patch repair of damaged concrete surfaces."],
    ["Floor screeding", "m²", "Application of floor screed to the specified area."],
    ["Bathroom tiling", "job", "Complete floor and wall tiling of a bathroom as described in this quotation."],
  ]},
  { name: "Gypsum & False Ceiling", prefix: "GYP", items: [
    ["Gypsum partition installation", "m²", "Supply and installation of a gypsum board partition."],
    ["Gypsum false ceiling installation", "m²", "Supply and installation of a gypsum false ceiling."],
    ["Ceiling tile replacement", "unit", "Removal and replacement of damaged ceiling tiles."],
    ["Suspended ceiling installation", "m²", "Supply and installation of a suspended ceiling system."],
    ["Gypsum board repair", "job", "Repair of damaged gypsum board partition or ceiling."],
    ["Decorative ceiling works", "job", "Decorative gypsum ceiling features as per the agreed design."],
    ["Ceiling access panel installation", "unit", "Supply and installation of a ceiling access panel."],
    ["Joint finishing and sanding", "m²", "Finishing, jointing and sanding of gypsum board surfaces ready for painting."],
  ]},
  { name: "Civil & Renovation Works", prefix: "CIV", items: [
    ["Villa renovation", "job", "Comprehensive renovation works for a villa, as described in this quotation."],
    ["Apartment renovation", "job", "Comprehensive renovation works for an apartment, as described in this quotation."],
    ["Office fit-out", "job", "Complete office fit-out works, as per the agreed scope and drawings."],
    ["Shop fit-out", "job", "Complete retail/shop fit-out works, as per the agreed scope and drawings."],
    ["Bathroom renovation", "job", "Complete bathroom renovation, as described in this quotation."],
    ["Kitchen renovation", "job", "Complete kitchen renovation, as described in this quotation."],
    ["Interior partition works", "m²", "Construction of interior partition walls."],
    ["Flooring renovation", "m²", "Removal of existing flooring and installation of new flooring finish."],
    ["Wall demolition", "m²", "Controlled demolition and removal of the specified wall."],
    ["Block wall construction", "m²", "Construction of a new block wall to the specified dimensions."],
    ["Concrete repair", "job", "Repair of damaged or deteriorated concrete elements."],
    ["Waterproofing works", "m²", "Application of a waterproofing membrane/system to the specified area."],
  ]},
  { name: "Air Duct Cleaning", prefix: "DUC", items: [
    ["Residential AC duct cleaning", "job", "Mechanical cleaning of residential AC ductwork to improve airflow and air quality."],
    ["Commercial AC duct cleaning", "job", "Mechanical cleaning of commercial AC ductwork to improve airflow and air quality."],
    ["Supply and return duct cleaning", "job", "Cleaning of supply and return air duct runs."],
    ["Air grille cleaning", "unit", "Removal, cleaning and refitting of air supply/return grilles."],
    ["Air handling unit cleaning", "unit", "Cleaning and inspection of an air handling unit (AHU)."],
    ["Kitchen exhaust duct cleaning", "job", "Degreasing and cleaning of kitchen exhaust ductwork."],
  ]},
  { name: "Handyman Services", prefix: "HND", items: [
    ["General handyman visit", "job", "A general handyman visit covering minor repairs/installations as described in this quotation."],
    ["Wall mounting", "unit", "Mounting of a TV, mirror or similar item to a wall."],
    ["Shelf installation", "unit", "Supply and installation of a wall-mounted shelf."],
    ["Curtain rod installation", "unit", "Supply and installation of a curtain rod/track."],
    ["Door adjustment", "unit", "Adjustment of a sticking, misaligned or noisy door."],
    ["Minor plumbing repair", "job", "Minor plumbing repair completed during a single visit."],
    ["Minor electrical repair", "job", "Minor electrical repair completed during a single visit."],
    ["Furniture assembly", "unit", "Assembly of flat-pack or ready-to-assemble furniture."],
    ["Silicone sealant replacement", "running metre", "Removal of old sealant and application of new silicone sealant."],
    ["General property repairs", "job", "General minor property repairs as described in this quotation."],
  ]},
  { name: "Cleaning Services", prefix: "CLN", items: [
    ["Residential deep cleaning", "job", "Thorough deep cleaning of a residential property."],
    ["Office deep cleaning", "job", "Thorough deep cleaning of an office space."],
    ["Post-renovation cleaning", "job", "Deep cleaning to remove dust and debris following renovation works."],
    ["Move-in and move-out cleaning", "job", "Deep cleaning of a property ahead of move-in or following move-out."],
    ["Kitchen deep cleaning", "job", "Thorough deep cleaning of a kitchen, including appliances and surfaces."],
    ["Bathroom deep cleaning", "job", "Thorough deep cleaning of a bathroom, including fittings and surfaces."],
    ["Floor cleaning", "m²", "Deep cleaning of floor surfaces."],
  ]},
  { name: "Fire Protection & Fireproofing", prefix: "FIR", items: [
    ["Fire-retardant lining installation", "m²", "Supply and installation of fire-retardant lining material."],
    ["Fireproof coating application", "m²", "Application of a fireproof coating to the specified surfaces."],
    ["Fire-resistant coating application", "m²", "Application of a fire-resistant coating to the specified surfaces."],
    ["Fire protection surface preparation", "m²", "Surface preparation prior to fire protection material application."],
    ["Fireproof coating touch-up", "job", "Touch-up/repair of existing fireproof coating."],
    ["Fire-resistant lining repair", "job", "Repair of damaged fire-resistant lining."],
    ["Fire protection material installation", "job", "Installation of fire protection materials as per approved specification."],
  ]},
  { name: "General Charges", prefix: "GEN", items: [
    ["Labour charges", "hour", "Supplementary labour charge for works described in this quotation."],
    ["Material supply charges", "job", "Supply of materials required for the works described in this quotation."],
    ["Material delivery", "job", "Delivery charge for materials to the project site."],
    ["Equipment rental", "day", "Rental of equipment required for the works described."],
    ["Waste removal", "job", "Removal and disposal of waste/debris from the project site."],
    ["Emergency call-out", "job", "Call-out charge for urgent/emergency attendance outside standard scheduling."],
    ["Additional approved works", "job", "Additional works beyond the original scope, approved by the client in writing."],
  ]},
];

// Flattened [{ itemCode, category, name, unit, description, defaultNotes }], built once.
export const CATALOG_ITEMS = CATEGORIES.flatMap(({ name, prefix, items }) =>
  items.map(([itemName, unit, description], i) => ({
    itemCode: `${prefix}-${String(i + 1).padStart(3, "0")}`,
    category: name,
    name: itemName,
    unit,
    description,
    defaultNotes: CATEGORY_NOTES[name],
  }))
);

// Idempotent: safe to call on every boot and at every signup. Relies on the
// (org_id, item_code) unique index added in migration 010 — a conflict means this exact
// catalog item already exists for this org, so it's left untouched (never overwrites a
// price, description or notes the org may have since customized).
export async function seedServiceCatalog(sql, orgId) {
  for (const item of CATALOG_ITEMS) {
    await sql`
      insert into items (org_id, item_code, category, name, description, unit, item_type, sale_price, vat_rate, default_notes, active)
      values (${orgId}, ${item.itemCode}, ${item.category}, ${item.name}, ${item.description}, ${item.unit}, 'service', 0, 5, ${item.defaultNotes}, true)
      on conflict (org_id, item_code) where item_code is not null do nothing
    `;
  }
}

export async function seedServiceCatalogForAllOrgs(sql) {
  const orgs = await sql`select id from orgs`;
  for (const org of orgs) {
    await seedServiceCatalog(sql, org.id);
  }
}
