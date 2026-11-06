// Home screen arrangement: explicit pages of apps and folders, so an app
// stays on the page you put it on. Each page flows from the top-left (no
// gaps), like iPadOS. When a page is over-full (a drop, or a smaller grid
// after rotation) the extra items move to the start of the next page.
// Pure data, persisted as JSON in the extension's `home-layout` setting.

const STEAM = ['steam.desktop', 'com.valvesoftware.Steam.desktop'];

export function itemId(item) {
    return typeof item === 'string' ? item : `folder:${item.id}`;
}

function cleanItem(item) {
    if (typeof item === 'string')
        return item;
    if (item && Array.isArray(item.apps) && item.id !== undefined) {
        return {id: String(item.id), name: String(item.name ?? 'Folder'),
            apps: item.apps.filter(app => typeof app === 'string')};
    }
    return null;
}

export class HomeLayout {
    constructor(json = '') {
        this.pageList = [];
        this._nextFolder = 1;
        try {
            const data = json ? JSON.parse(json) : null;
            if (data && Array.isArray(data.pages)) {
                this.pageList = data.pages.filter(Array.isArray)
                    .map(page => page.map(cleanItem).filter(Boolean));
            } else if (data && Array.isArray(data.items)) {
                // Version 1: one flat list. Keep it on one logical run; the
                // first pages() call splits it by the current grid size.
                this.pageList = [data.items.map(cleanItem).filter(Boolean)];
            }
        } catch (e) {
            this.pageList = [];
        }
        this.pageList = this.pageList.filter(page => page.length);
        for (const item of this.items) {
            if (typeof item !== 'string')
                this._nextFolder = Math.max(this._nextFolder, (parseInt(item.id, 10) || 0) + 1);
        }
    }

    get empty() { return this.items.length === 0; }

    // Every item in page order.
    get items() { return this.pageList.flat(); }

    // First run: alphabetical, with games gathered in a folder (Steam stays
    // on the grid). `apps` is [{id, name, categories: string[]}].
    seed(apps) {
        const sorted = [...apps].sort((a, b) => a.name.localeCompare(b.name));
        const games = sorted.filter(app => app.categories.includes('Game') && !STEAM.includes(app.id));
        const gameIds = new Set(games.length >= 2 ? games.map(app => app.id) : []);
        const items = sorted.filter(app => !gameIds.has(app.id)).map(app => app.id);
        if (gameIds.size)
            items.push({id: String(this._nextFolder++), name: 'Games', apps: [...gameIds]});
        this.pageList = items.length ? [items] : [];
        return this;
    }

    // Keep only installed apps; new installs go to the end of the last page.
    sync(installed) {
        const present = new Set(installed);
        const seen = new Set();
        const before = JSON.stringify(this.pageList);
        this.pageList = this.pageList.map(page => {
            const next = [];
            for (const item of page) {
                if (typeof item === 'string') {
                    if (present.has(item) && !seen.has(item)) {
                        seen.add(item);
                        next.push(item);
                    }
                    continue;
                }
                item.apps = item.apps.filter(app => present.has(app) && !seen.has(app));
                item.apps.forEach(app => seen.add(app));
                if (item.apps.length >= 2)
                    next.push(item);
                else if (item.apps.length === 1)
                    next.push(item.apps[0]);
            }
            return next;
        }).filter(page => page.length);
        const added = installed.filter(app => !seen.has(app));
        added.forEach(app => seen.add(app));
        if (added.length) {
            if (!this.pageList.length)
                this.pageList.push([]);
            this.pageList.at(-1).push(...added);
        }
        return JSON.stringify(this.pageList) !== before;
    }

    // Fit pages to the grid size: overflow cascades to the next page.
    // Returns the pages (always at least one, possibly empty).
    pages(perPage) {
        const size = Math.max(1, perPage);
        for (let i = 0; i < this.pageList.length; i++) {
            const page = this.pageList[i];
            if (page.length > size) {
                const extra = page.splice(size);
                if (i + 1 < this.pageList.length)
                    this.pageList[i + 1].unshift(...extra);
                else
                    this.pageList.push(extra);
            }
        }
        this.pageList = this.pageList.filter(page => page.length);
        return this.pageList.length ? this.pageList.map(page => [...page]) : [[]];
    }

    // {page, index} of an item, or null.
    locate(id) {
        for (let page = 0; page < this.pageList.length; page++) {
            const index = this.pageList[page].findIndex(item => itemId(item) === id);
            if (index >= 0)
                return {page, index};
        }
        return null;
    }

    indexOf(id) {
        return this.items.findIndex(item => itemId(item) === id);
    }

    folder(id) {
        return this.items.find(item => typeof item !== 'string' && itemId(item) === id) ?? null;
    }

    _take(id) {
        const at = this.locate(id);
        if (!at)
            return null;
        const [item] = this.pageList[at.page].splice(at.index, 1);
        return {item, ...at};
    }

    // Move an item to `index` on `page` (a page past the end creates one).
    // Empty pages are removed afterwards, except the one being dropped on.
    move(id, page, index) {
        const from = this.locate(id);
        if (!from)
            return false;
        const taken = this._take(id);
        const target = Math.max(0, Math.min(this.pageList.length, page));
        if (target === this.pageList.length)
            this.pageList.push([]);
        const list = this.pageList[target];
        list.splice(Math.max(0, Math.min(list.length, index)), 0, taken.item);
        this.pageList = this.pageList.filter(p => p.length);
        const to = this.locate(id);
        return from.page !== to.page || from.index !== to.index;
    }

    // Drop an app onto another app (new folder) or onto a folder (join it).
    dropOnto(id, targetId, name = 'Folder') {
        if (id === targetId || id.startsWith('folder:'))
            return false;
        const target = this.locate(targetId);
        if (!this.locate(id) || !target)
            return false;
        const targetItem = this.pageList[target.page][target.index];
        if (typeof targetItem !== 'string') {
            this._take(id);
            targetItem.apps.push(id);
        } else {
            const folder = {id: String(this._nextFolder++), name, apps: [targetItem, id]};
            this.pageList[target.page][target.index] = folder;
            this._take(id);
        }
        this.pageList = this.pageList.filter(p => p.length);
        return true;
    }

    // Take an app out of a folder; it lands right after the folder.
    removeFromFolder(folderId, app) {
        const at = this.locate(folderId);
        if (!at)
            return false;
        const page = this.pageList[at.page];
        const folder = page[at.index];
        if (typeof folder === 'string' || !folder.apps.includes(app))
            return false;
        folder.apps = folder.apps.filter(a => a !== app);
        const replacement = folder.apps.length >= 2 ? [folder, app] : [...folder.apps, app];
        page.splice(at.index, 1, ...replacement);
        return true;
    }

    renameFolder(folderId, name) {
        const folder = this.folder(folderId);
        if (!folder || !name.trim())
            return false;
        folder.name = name.trim();
        return true;
    }

    serialize() {
        return JSON.stringify({version: 2, pages: this.pageList});
    }
}
