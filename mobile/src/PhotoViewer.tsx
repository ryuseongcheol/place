import { Image } from "expo-image";
import { useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/** 사진 크게 보기 (기기에 저장된 내 사진용). 좌우로 넘긴다 */
export default function PhotoViewer({ photos, index, onClose }: { photos: string[] | null; index: number; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const [cur, setCur] = useState(index);
  if (!photos) return null;
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} onShow={() => setCur(index)}>
      <SafeAreaView style={styles.wrap} edges={["top", "bottom"]}>
        <View style={styles.bar}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="닫기" style={{ padding: 6 }}>
            <Text style={{ color: "#fff", fontSize: 20 }}>✕</Text>
          </Pressable>
          <Text style={{ color: "#fff", fontWeight: "600" }}>
            {cur + 1} / {photos.length}
          </Text>
          <View style={{ width: 32 }} />
        </View>
        <FlatList
          data={photos}
          keyExtractor={(u) => u}
          horizontal
          pagingEnabled
          initialScrollIndex={index}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setCur(Math.round(e.nativeEvent.contentOffset.x / width))}
          renderItem={({ item }) => <Image source={{ uri: item }} style={{ width, height: height - 120 }} contentFit="contain" />}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#000" },
  bar: { height: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 10 },
});
