# Data notice

The MIT license in this repository covers the software written for CityCenter. It does not cover the data in this folder, which belongs to its sources.

Trust City is an example city, not a real place. The code and map data below are public records of Hildale, Utah, shown under the Trust City name. Hildale City did not make or review this project.

## Parcels and tax-roll facts (`parcels.geojson`, `lir.json`)

Parcel data derived from the UGRC SGID under the CC BY 4.0 license (https://creativecommons.org/licenses/by/4.0/). Credit: Utah Geospatial Resource Center (UGRC), State Geographic Information Datasource.

Sources, accessed 2026-10-28:
- https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/Parcels_Washington/FeatureServer/0
- https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/Parcels_Washington_LIR/FeatureServer/0
- https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/UtahRoads/FeatureServer/0 (`roads.geojson`, accessed 2026-11-03; street names and lines only)

Layer metadata is published at those addresses and at https://gis.utah.gov/data/cadastre/parcels.

Changes made: kept one town's records and a subset of fields, did not store market values, and joined tax-roll facts to parcels. When the app loads the data, it replaces the town's name with the example city's name, Trust City. The app also computes areas and zones and shows invented owner names, which are not part of this data.

UGRC disclaimer:

> The data, including but not limited to geographic data, tabular data, and analytical data, are provided “as is” and “as available”, with no guarantees relating to the availability, completeness, or accuracy of data, and without any express or implied warranties.
>
> These data are provided as a public service for informational purposes only. You are solely responsible for obtaining the proper evaluation of a location and associated data by a qualified professional. UGRC reserves the right to change, revise, suspend or discontinue published data and services without notice at any time.
>
> Neither UGRC nor the State of Utah are responsible for any misuse or misrepresentation of the data. UGRC and the State of Utah are not obligated to provide you with any maintenance or support. The user assumes the entire risk as to the quality and performance of the data. You agree to hold the State of Utah harmless for any claims, liability, costs, and damages relating to your use of the data. You agree that your sole remedy for any dissatisfaction or claims is to discontinue use of the data.

## Aerial photo (not stored here)

The sketch pad's aerial layer shows USDA National Agriculture Imagery Program (NAIP) photos through the USGS National Map (https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer). Credit: USGS, USDA, The National Map: Orthoimagery. It is fetched when a resident asks for it, and only for this town.

## Zoning (`zoning.geojson`)

Washington County, Utah GIS public zoning layer: https://agisprodvm.washco.utah.gov/arcgis/rest/services/Zoning/MapServer/4. The county's map data is for display only and should be independently verified. The layer publishes no license text; the data remains the county's.

## City code (`code.json`)

The town's published ordinances, from its Municipal Code Online site. The official hard copy governs. The app replaces the town's name with the example city's name, Trust City.

## Sample procedures (`services.json`, `sources.json`)

The procedures, forms, fees and timelines in `services.json` are original samples written for the example city. They are not the rules of any real city. `sources.json` lists the real public pages read while writing them; no text was copied from those pages, and each stays the property of its publisher.
