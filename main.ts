//% block="Better Overlaps"
//% color="#FB8C00" icon="\uf259"
//% groups="['Overlaps']"
namespace overlaps {
    export const SPRITE_DATA_KEY = "@$_events_sprite_data";

    export enum SpriteEvent {
        //% block="starts overlapping"
        StartOverlapping,
        //% block="stops overlapping"
        StopOverlapping
    }

    export enum TileEvent {
        //% block="starts overlapping"
        StartOverlapping,
        //% block="stops overlapping"
        StopOverlapping,
        //% block="fully within"
        Enters,
        //% block="no longer fully within"
        Exits,
        //% block="fully within area covered by"
        EntersArea,
        //% block="no longer fully within area covered by"
        ExitsArea
    }

    enum TileFlag {
        Overlapping = 1 << 0, // Sprite's bounding box intersects with any tile of the target image
        FullyWithin = 1 << 1, // Sprite's bounding box is entirely contained within a single tile of the target image
        WithinArea = 1 << 2  // Sprite's bounding box is overlapping, and all tiles it overlaps are of the target image
    }

    type SpriteHandler = (sprite: Sprite, otherSprite: Sprite) => void;
    type TileHandler = (sprite: Sprite, location: tiles.Location) => void;

    let stateStack: EventState[];

    class EventState {
        spriteHandlers: SpriteHandlerEntry[];
        tileHandlers: TileHandlerEntry[];
        trackedSprites: Sprite[];

        constructor() {
            this.spriteHandlers = [];
            this.tileHandlers = [];
            this.trackedSprites = [];

            // Register a frame handler to update overlap states each frame after physics.
            game.eventContext().registerFrameHandler(scene.PHYSICS_PRIORITY + 1, () => {
                this.update();
            });
        }

        // Updates the overlap state for all tracked sprites.
        update() {
            for (const sprite of this.trackedSprites) {
                if (!sprite || sprite.flags & sprites.Flag.Destroyed) continue;

                const data = sprite.data[SPRITE_DATA_KEY] as SpriteEventData;
                if (!data) continue;

                // Update sprite-on-sprite overlap states
                for (let i = data.overlappingSprites.length - 1; i >= 0; i--) {
                    const otherSprite = data.overlappingSprites[i];
                    if (!otherSprite || otherSprite.flags & sprites.Flag.Destroyed || !sprite.overlapsWith(otherSprite)) {
                        data.overlappingSprites.removeElement(otherSprite);
                        if (!otherSprite || otherSprite.flags & sprites.Flag.Destroyed) continue;

                        const handler = this.getSpriteHandler(SpriteEvent.StopOverlapping, sprite.kind(), otherSprite.kind());
                        if (handler) handler.handler(sprite, otherSprite);
                    }
                }

                // Update sprite-on-tile overlap states by checking against registered tile handlers
                const tileMap = game.currentScene().tileMap;
                if (tileMap) {
                    for (const handlerEntry of this.tileHandlers) { // Check each registered tile event handler
                        if (handlerEntry.kind === sprite.kind()) { // If the sprite kind matches
                            const targetTileIndex = tileMap.getImageType(handlerEntry.tile);
                            if (targetTileIndex !== -1) {
                                // Update state for this sprite and specific tile image.
                                // No specific tile instance location is known from this general update loop context.
                                updateTileStateAndFireEvents(
                                    sprite,
                                    targetTileIndex,
                                    tileMap,
                                    undefined // specificLocation is undefined here
                                );
                            }
                        }
                    }
                }
            }
            this.pruneTrackedSprites();
        }

        getSpriteHandler(event: SpriteEvent, kind: number, otherKind: number) {
            for (const handler of this.spriteHandlers) {
                if (handler.event === event && handler.kind === kind && handler.otherKind === otherKind)
                    return handler;
            }
            return undefined;
        }

        getTileHandler(event: TileEvent, kind: number, image: Image) {
            for (const handler of this.tileHandlers) {
                if (handler.event === event && handler.kind === kind && handler.tile && handler.tile.equals(image))
                    return handler;
            }
            return undefined;
        }

        // Removes destroyed sprites from the tracking list.
        protected pruneTrackedSprites() {
            for (let i = this.trackedSprites.length - 1; i >= 0; i--) {
                const sprite = this.trackedSprites[i];
                if (!sprite || sprite.flags & sprites.Flag.Destroyed) {
                    this.trackedSprites.removeAt(i);
                }
            }
        }
    }

    class SpriteHandlerEntry {
        constructor(
            public event: SpriteEvent,
            public kind: number,
            public otherKind: number,
            public handler: SpriteHandler
        ) { }
    }

    class TileHandlerEntry {
        constructor(
            public event: TileEvent,
            public kind: number,
            public tile: Image, // The tile image this handler is for
            public handler: TileHandler
        ) { }
    }

    // Custom data attached to each sprite to track its overlap states.
    class SpriteEventData {
        overlappingSprites: Sprite[]; // Sprites this sprite is currently overlapping with
        tiles: TileState[];           // State of overlap with different tile images

        constructor(public owner: Sprite) {
            this.overlappingSprites = [];
            this.tiles = [];
        }

        // Retrieves or creates a TileState for a given tile image index.
        getTileEntry(tileIndex: number, createIfMissing = false) {
            for (const tile of this.tiles) {
                if (tile.tileIndex === tileIndex) {
                    return tile;
                }
            }

            if (createIfMissing) {
                const newEntry = new TileState(tileIndex);
                this.tiles.push(newEntry)
                return newEntry;
            }
            return undefined;
        }
    }

    // Tracks a sprite's overlap state with a specific tile image.
    class TileState {
        flag: number; // Bitmask of TileFlags (Overlapping, FullyWithin, WithinArea)
        lastKnownLocation?: tiles.Location; // Location of the specific tile instance last interacted with

        constructor(public tileIndex: number, flag = 0) {
            this.flag = flag;
        }
    }

    // Initializes the overlap system and scene event handlers if not already done.
    function init() {
        if (stateStack) return;
        stateStack = [new EventState()]; // Initialize with a state for the current scene

        // Handle scene changes by pushing/popping states.
        game.addScenePushHandler(() => {
            stateStack.push(new EventState());
        });

        game.addScenePopHandler(() => {
            if (stateStack.length > 1) {
                stateStack.pop();
            } else if (stateStack.length === 0) { // Should not happen in normal operation
                stateStack.push(new EventState());
            }
        });
    }

    // Gets the current active EventState.
    function state() {
        init(); // Ensure initialization
        return stateStack[stateStack.length - 1];
    }

    //% blockId=sprite_overlap_sprite_event
    //% block="on $sprite of kind $kind $event with $otherSprite of kind $otherKind"
    //% draggableParameters="reporter"
    //% kind.shadow=spritekind
    //% otherKind.shadow=spritekind
    //% group="Overlaps"
    export function spriteEvent(kind: number, otherKind: number, event: SpriteEvent, handler: (sprite: Sprite, otherSprite: Sprite) => void) {
        init();

        const existing = state().getSpriteHandler(event, kind, otherKind);
        if (existing) { // Allow overriding existing handler
            existing.handler = handler;
            return;
        }

        state().spriteHandlers.push(
            new SpriteHandlerEntry(event, kind, otherKind, handler)
        );

        // Use the built-in onOverlap for initial detection of sprite-sprite overlaps.
        sprites.onOverlap(kind, otherKind, (sprite, otherSprite) => {
            const currentState = state();
            if (!sprite || !otherSprite || sprite.flags & sprites.Flag.Destroyed || otherSprite.flags & sprites.Flag.Destroyed) return;

            if (!sprite.data[SPRITE_DATA_KEY]) {
                sprite.data[SPRITE_DATA_KEY] = new SpriteEventData(sprite);
                if (currentState.trackedSprites.indexOf(sprite) === -1) {
                    currentState.trackedSprites.push(sprite);
                }
            }

            const data: SpriteEventData = sprite.data[SPRITE_DATA_KEY];
            if (!data) return;
            const isOverlappingAlready = data.overlappingSprites.indexOf(otherSprite) !== -1;

            if (!isOverlappingAlready) {
                data.overlappingSprites.push(otherSprite);

                // Fire "StartOverlapping" if this is the event type being registered for.
                // Note: This current structure means only StartOverlapping is directly triggered by sprites.onOverlap.
                // StopOverlapping for sprites is handled in EventState.update.
                const startHandler = currentState.getSpriteHandler(SpriteEvent.StartOverlapping, kind, otherKind)
                if (startHandler && event === SpriteEvent.StartOverlapping) {
                    startHandler.handler(sprite, otherSprite);
                }
            }
        });
    }

    //% blockId=sprite_overlap_tile_event
    //% block="on $sprite of kind $kind $event tile $tile at $location"
    //% draggableParameters="reporter"
    //% kind.shadow=spritekind
    //% tile.shadow=tileset_tile_picker
    //% tile.defl=assets.tile`myTile`
    //% group="Overlaps"
    export function tileEvent(kind: number, tile: Image, event: TileEvent, handler: (sprite: Sprite, location: tiles.Location) => void) {
        init();
        if (!tile) return;

        const existing = state().getTileHandler(event, kind, tile);
        if (existing) { // Allow overriding existing handler
            existing.handler = handler;
            return;
        }

        state().tileHandlers.push(
            new TileHandlerEntry(event, kind, tile, handler)
        );

        // Use the built-in scene.onOverlapTile for initial detection of sprite starting to overlap a tile instance.
        scene.onOverlapTile(kind, tile, (sprite, locationOfOverlappedTile) => {
            if (!sprite || !locationOfOverlappedTile) return;
            const tileMapInstance = game.currentScene().tileMap;
            if (!tileMapInstance) return;

            const tileIndex = tileMapInstance.getImageType(tile); // Index of the tile image specified in the block

            if (tileIndex !== -1) {
                // Process this specific tile instance overlap.
                // locationOfOverlappedTile is the crucial piece of information from the engine.
                updateTileStateAndFireEvents(sprite, tileIndex, tileMapInstance, locationOfOverlappedTile);
            }
        });
    }

    // Central function to update a sprite's overlap state with a given tile image and fire relevant events.
    // `specificLocation` is provided when this call originates from `scene.onOverlapTile` (an actual tile instance).
    function updateTileStateAndFireEvents(sprite: Sprite, tileIndex: number, map: tiles.TileMap, specificLocation?: tiles.Location) {
        if (!sprite || !map) return;
        let data: SpriteEventData = sprite.data[SPRITE_DATA_KEY];

        if (!data) { // Ensure sprite has custom data store
            data = new SpriteEventData(sprite);
            sprite.data[SPRITE_DATA_KEY] = data;
            if (state().trackedSprites.indexOf(sprite) === -1) {
                state().trackedSprites.push(sprite); // Add to tracked list if new
            }
        }

        const tileState = data.getTileEntry(tileIndex, true); // Get or create state for this sprite vs tile image
        const oldFlags = tileState.flag;

        // If a specificLocation is provided by an engine event (scene.onOverlapTile),
        // it means the sprite is currently interacting with THIS instance of the tile image.
        // Update lastKnownLocation to this most recent, specific interaction point.
        // This is crucial for "StopOverlapping" to report the correct tile instance left,
        // especially if the sprite moves between different instances of the same tile image.
        if (specificLocation) {
            tileState.lastKnownLocation = specificLocation;
        }

        updateTileState(tileState, sprite, tileIndex, map); // Recalculate current overlap flags with the tile image

        // If the computed overlap flags haven't changed, no state transition event needs to fire.
        if (oldFlags === tileState.flag) {
            return;
        }

        const tileImageForHandler = map.getTileImage(tileIndex); // The actual image for this tile index
        if (!tileImageForHandler) return; // Should not happen if tileIndex is valid

        const currentState = state();
        // Fallback location if no specific instance location is highly relevant (e.g., for general area events without a specific trigger instance).
        const fallbackLocation = sprite.tilemapLocation();

        // Check for StartOverlapping state change
        if (tileState.flag & TileFlag.Overlapping) {
            if (!(oldFlags & TileFlag.Overlapping)) { // Condition: Was not overlapping, now is.
                const handler = currentState.getTileHandler(TileEvent.StartOverlapping, sprite.kind(), tileImageForHandler);
                if (handler) {
                    // Use lastKnownLocation (which would have been set by specificLocation if available)
                    // or fallback to sprite's current center tile.
                    handler.handler(sprite, tileState.lastKnownLocation || fallbackLocation);
                }
            }
        } else if (oldFlags & TileFlag.Overlapping) { // Condition: Was overlapping, now is not.
            const handler = currentState.getTileHandler(TileEvent.StopOverlapping, sprite.kind(), tileImageForHandler);
            if (handler) {
                // For "StopOverlapping", use the lastKnownLocation that was cached.
                // This should be the location of the tile instance being left.
                handler.handler(sprite, tileState.lastKnownLocation || fallbackLocation);
            }
        }

        // Location to use for area-based events or fully-within events.
        // Prioritizes the last specific instance, then falls back.
        const locationForBoundaryEvents = tileState.lastKnownLocation || fallbackLocation;

        // Check for Enters/Exits FullyWithin state changes
        if (tileState.flag & TileFlag.FullyWithin) {
            if (!(oldFlags & TileFlag.FullyWithin)) {
                const handler = currentState.getTileHandler(TileEvent.Enters, sprite.kind(), tileImageForHandler);
                if (handler) handler.handler(sprite, locationForBoundaryEvents);
            }
        } else if (oldFlags & TileFlag.FullyWithin) {
            const handler = currentState.getTileHandler(TileEvent.Exits, sprite.kind(), tileImageForHandler);
            if (handler) handler.handler(sprite, locationForBoundaryEvents);
        }

        // Check for EntersArea/ExitsArea state changes
        if (tileState.flag & TileFlag.WithinArea) {
            if (!(oldFlags & TileFlag.WithinArea)) {
                const handler = currentState.getTileHandler(TileEvent.EntersArea, sprite.kind(), tileImageForHandler);
                if (handler) handler.handler(sprite, locationForBoundaryEvents);
            }
        } else if (oldFlags & TileFlag.WithinArea) {
            const handler = currentState.getTileHandler(TileEvent.ExitsArea, sprite.kind(), tileImageForHandler);
            if (handler) handler.handler(sprite, locationForBoundaryEvents);
        }

        // If sprite is no longer in any overlap state with this tile image, clear cached location and remove state.
        if (tileState.flag === 0) {
            tileState.lastKnownLocation = undefined;
            if (data.tiles.indexOf(tileState) !== -1) { // Check if it's still in the array before removing
                data.tiles.removeElement(tileState);
            }
        }
    }

    // Calculates and updates the TileState's flags based on the sprite's current position
    // relative to tiles of tileIndexToMatch in the given tilemap.
    function updateTileState(tileState: TileState, sprite: Sprite, tileIndexToMatch: number, map: tiles.TileMap) {
        const tileWidth = 1 << map.scale; // Actual width/height of a tile in pixels

        const spriteL = sprite.left;
        const spriteT = sprite.top;
        const spriteR = sprite.right;
        const spriteB = sprite.bottom;

        // Determine the range of tile coordinates covered by the sprite's bounding box.
        const x0 = Math.idiv(spriteL, tileWidth);
        const y0 = Math.idiv(spriteT, tileWidth);
        const x1 = Math.idiv(spriteR, tileWidth);
        const y1 = Math.idiv(spriteB, tileWidth);

        tileState.flag = 0; // Reset flags for recalculation

        // Case 1: Sprite is small enough to potentially be fully within a single tile.
        if (x0 === x1 && y0 === y1) {
            if (x0 >= 0 && x0 < map.areaWidth() && y0 >= 0 && y0 < map.areaHeight()) { // Check if within map bounds
                const currentTile = map.getTile(x0, y0);
                if (currentTile && currentTile.tileSet === tileIndexToMatch) {
                    // If the single tile it overlaps matches, then all flags apply.
                    tileState.flag = TileFlag.Overlapping | TileFlag.FullyWithin | TileFlag.WithinArea;
                }
            }
            return; // State determined
        }

        // Case 2: Sprite potentially covers multiple tiles.
        let isOverlappingAnyMatchingTile = false;
        let isSpriteFullyContainedWithinMatchingTiles = true; // Assume true until a non-matching tile is found under the sprite

        for (let x = x0; x <= x1; x++) {
            for (let y = y0; y <= y1; y++) {
                // If any part of the sprite's covered tile grid is outside map, it's not fully within an area of matching tiles.
                if (x < 0 || x >= map.areaWidth() || y < 0 || y >= map.areaHeight()) {
                    isSpriteFullyContainedWithinMatchingTiles = false;
                    continue; // Don't check tiles outside map bounds
                }

                const currentTile = map.getTile(x, y);
                if (currentTile && currentTile.tileSet === tileIndexToMatch) {
                    isOverlappingAnyMatchingTile = true; // Found at least one matching tile under the sprite
                } else {
                    // If any tile under the sprite does NOT match, it's not "WithinArea" of only matching tiles.
                    isSpriteFullyContainedWithinMatchingTiles = false;
                }
            }
        }

        if (isOverlappingAnyMatchingTile) {
            tileState.flag |= TileFlag.Overlapping;
            if (isSpriteFullyContainedWithinMatchingTiles) {
                // If it's overlapping and all tiles it's currently over are of the target image type.
                tileState.flag |= TileFlag.WithinArea;
            }
        }
        // Note: FullyWithin for multi-tile sprites is not set here, as it implies fitting within ONE tile.
        // That's handled by the (x0 === x1 && y0 === y1) case.
    }

    /**
     * Checks if a sprite is currently overlapping any tile with the specified image.
     * This is a synchronous check performed at the moment the block is called.
     * @param sprite The sprite to check.
     * @param tileImage The image of the tile to check for overlap with.
     * @returns true if the sprite is overlapping a tile with the given image, false otherwise.
     */
    //% blockId=sprite_overlap_tile_bool
    //% block="$sprite is currently overlapping tile image $tileImage"
    //% sprite.shadow=variables_get
    //% sprite.defl=mySprite
    //% tileImage.shadow=tileset_tile_picker
    //% tileImage.defl=assets.tile`myTile`
    //% group="Overlaps"
    export function isSpriteOverlappingTileImage(sprite: Sprite, tileImage: Image): boolean {
        if (!sprite || !tileImage) {
            return false;
        }

        const scene = game.currentScene();
        const tm = scene.tileMap;

        if (!tm || tm.areaWidth() === 0 || tm.areaHeight() === 0) {
            return false;
        }

        const scale = 1 << tm.scale; // tile dimensions in pixels

        const spriteL = sprite.left;
        const spriteR = sprite.right;
        const spriteT = sprite.top;
        const spriteB = sprite.bottom;

        // Determine the tilemap column/row range the sprite could be in.
        const minCol = Math.max(0, Math.floor(spriteL / scale));
        const maxCol = Math.min(tm.areaWidth() - 1, Math.floor(spriteR / scale));
        const minRow = Math.max(0, Math.floor(spriteT / scale));
        const maxRow = Math.min(tm.areaHeight() - 1, Math.floor(spriteB / scale));

        // Iterate through this range of tiles.
        for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
                const tileObject = tm.getTile(c, r); // Contains image index and wall status

                if (tileObject && tileObject.tileSet !== undefined) { // Check if tile has an image
                    const currentTileImgFromMap = tm.getTileImage(tileObject.tileSet);

                    if (currentTileImgFromMap && currentTileImgFromMap.equals(tileImage)) {
                        // If images match, perform a precise geometric check for overlap.
                        const tileLeft = c * scale;
                        const tileTop = r * scale;
                        const tileRight = tileLeft + scale;
                        const tileBottom = tileTop + scale;

                        // Standard AABB (Axis-Aligned Bounding Box) collision check.
                        if (spriteL < tileRight &&
                            spriteR > tileLeft &&
                            spriteT < tileBottom &&
                            spriteB > tileTop) {
                            return true; // Overlap detected with this tile instance
                        }
                    }
                }
            }
        }
        return false; // No overlap found with any tile of the specified image
    }
}