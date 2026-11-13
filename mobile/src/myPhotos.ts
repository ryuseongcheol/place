import { Directory, File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";

/**
 * 내 평가 사진: 고르거나 찍은 사진을 앱 저장 공간(document/mynotes)에 복사해 둔다.
 * 갤러리 원본을 지워도, 앱을 업데이트해도 남는다 (앱을 지우면 함께 지워진다).
 */
export const MAX_MY_PHOTOS = 10;
const dir = Platform.OS === "web" ? null : new Directory(Paths.document, "mynotes");

async function keep(placeId: string, assets: ImagePicker.ImagePickerAsset[]): Promise<string[]> {
  if (!dir) return assets.map((a) => a.uri);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const out: string[] = [];
  for (const [i, a] of assets.entries()) {
    try {
      const ext = (a.fileName?.split(".").pop() ?? a.uri.split(".").pop() ?? "jpg").toLowerCase().slice(0, 5);
      const dest = new File(dir, `${placeId.replace(/[^\w-]/g, "_")}-${Date.now()}-${i}.${ext}`);
      await new File(a.uri).copy(dest);
      out.push(dest.uri);
    } catch {
      out.push(a.uri); // 복사가 안 되면 원본 주소라도
    }
  }
  return out;
}

/** 앨범에서 여러 장 고르기 */
export async function pickFromLibrary(placeId: string, remaining: number): Promise<string[]> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: true,
    selectionLimit: Math.max(1, remaining),
    orderedSelection: true,
    quality: 0.7,
  });
  if (res.canceled) return [];
  return keep(placeId, res.assets.slice(0, remaining));
}

/** 카메라로 찍기 */
export async function takePhoto(placeId: string): Promise<string[]> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error("카메라 권한이 없어요. 설정에서 카메라 권한을 켜주세요.");
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7 });
  if (res.canceled) return [];
  return keep(placeId, res.assets);
}

export function deletePhotoFile(uri: string) {
  try {
    if (dir && uri.startsWith(dir.uri)) {
      const f = new File(uri);
      if (f.exists) f.delete();
    }
  } catch {
    // 무시
  }
}
