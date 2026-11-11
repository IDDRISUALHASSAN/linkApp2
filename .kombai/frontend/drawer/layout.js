import { Drawer } from "expo-router/drawer";
import {
  Home,
  Users,
  User,
  Settings,
  LogOut,
  Bell,
  Menu,
  MessageSquareMore,
} from "lucide-react-native";
import { Pressable, StyleSheet, Text, View, AppState } from "react-native";
import HeaderBell from "@/components/HeaderBell";
import { useInquiryCount, refreshInquiryCount } from "@/components/inquiries/inquiryStore";
import { attachInquirySocket } from "@/components/inquiries/inquirySocketBridge";
import { getSocket } from "@/services/socket";
import { useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useCallback } from "react";

function InquiryBadge() {
  const count = useInquiryCount();
  if (!count) return null;
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{count > 99 ? "99+" : count}</Text>
    </View>
  );
}

export default function DrawerLayout() {
  // Keep the unread badge fresh: on focus + when the app comes to foreground
  useFocusEffect(
    useCallback(() => {
      refreshInquiryCount();
    }, []),
  );

  useEffect(() => {
    const socket = getSocket();
    const detach = attachInquirySocket(socket);
    const sub = AppState.addEventListener
      ? AppState.addEventListener("change", (s) => {
          if (s === "active") refreshInquiryCount();
        })
      : null;
    return () => {
      detach?.();
      sub?.remove?.();
    };
  }, []);

  return (
    <Drawer
      initialRouteName="(tabs)"
      screenOptions={({ navigation }) => ({
        headerShown: true,
        headerStyle: { backgroundColor: "#05a31dff" },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "bold" },
        headerLeft: () => (
          <Pressable
            onPress={() => navigation?.toggleDrawer?.()}
            style={styles.menuButton}
            accessibilityRole="button"
            accessibilityLabel="Open navigation menu"
            hitSlop={10}
          >
            <Menu size={24} color="#fff" />
          </Pressable>
        ),
        headerRight: () => <HeaderBell />,
        drawerType: "front",
        drawerStyle: { width: 280, backgroundColor: "#fff" },
        overlayColor: "rgba(0, 0, 0, 0.45)",
        swipeEnabled: true,
        drawerActiveTintColor: "#05a31dff",
        drawerActiveBackgroundColor: "#eaf7ec",
        drawerLabelStyle: { fontSize: 15, fontWeight: "600" },
        drawerInactiveTintColor: "#555",
      })}
    >
      <Drawer.Screen
        name="(tabs)"
        options={{
          drawerLabel: "Home",
          title: "Dashboard",
          drawerIcon: ({ color, size }) => (
            <Home size={size} color={color} />
          ),
        }}
      />

      <Drawer.Screen
        name="inquiries"
        options={{
          drawerLabel: "Inquiries",
          title: "Inquiries",
          drawerIcon: ({ color, size }) => (
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <MessageSquareMore size={size} color={color} />
              <InquiryBadge />
            </View>
          ),
        }}
      />

      <Drawer.Screen
        name="contacts"
        options={{
          drawerLabel: "Contacts",
          title: "Your Contacts",
          drawerIcon: ({ color, size }) => (
            <Users size={size} color={color} />
          ),
        }}
      />

      <Drawer.Screen
        name="profile"
        options={{
          drawerLabel: "Profile",
          title: "My Profile",
          drawerIcon: ({ color, size }) => (
            <User size={size} color={color} />
          ),
        }}
      />

      <Drawer.Screen
        name="notifications"
        options={{
          drawerLabel: "Notifications",
          title: "Notifications",
          drawerIcon: ({ color, size }) => (
            <Bell size={size} color={color} />
          ),
        }}
      />

      <Drawer.Screen
        name="setting"
        options={{
          drawerLabel: "Settings",
          title: "App Settings",
          drawerIcon: ({ color, size }) => (
            <Settings size={size} color={color} />
          ),
        }}
      />

      <Drawer.Screen
        name="logout"
        options={{
          drawerLabel: "Logout",
          title: "Logout",
          drawerIcon: ({ color, size }) => (
            <LogOut size={size} color={color} />
          ),
        }}
      />
    </Drawer>
  );
}

const styles = StyleSheet.create({
  menuButton: {
    width: 48,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#ff3b30",
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 6,
  },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
});
