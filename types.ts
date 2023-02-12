export interface Place {
  raRad: number;
  decRad: number;
  zoomDeg: number;
  rollRad?: number;
}

export function isPlace(item: any): item is Place {
  return typeof item.raRad === "number" &&
         typeof item.decRad === "number" &&
         typeof item.zoomDeg === "number" &&
         item.rollRad === undefined || typeof item.rollRad === "number";
}

export interface Scene {
  name: string;
  imageURLs: string[]; // Relative?
  user: string;
  place: Place;
}

export function isScene(item: any): item is Scene {
  const types = Array.isArray(item.imageURLs) &&
                typeof item.name === "string" &&
                typeof item.user === "string" &&
                isPlace(item.place);
    if (!types) {
      return types;
    }

  const urls = item.imageURLs as string[];
  return urls.every(url => typeof url === "string");
}

export type OptionalFields<T> = {
  [P in keyof T]?: OptionalFields<T[P]>
}

export type SceneKeys = keyof Scene | "id";
export type SceneSettings = OptionalFields<Scene> & { id: string };

export function isSceneSettings(item: any): item is SceneSettings {
  const types = (item.imageURLs === undefined || Array.isArray(item.imageURLs)) &&
                (item.name === undefined || typeof item.name === "string") &&
                (item.user === undefined || typeof item.user === "string") &&
                (item.place === undefined || isPlace(item.place));
    if (!types) {
      return types;
    }

  const urls = item.imageURLs;
  return urls === undefined || (urls as string[]).every(url => typeof url === "string");
}
