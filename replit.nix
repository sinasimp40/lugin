{pkgs}: {
  deps = [
    pkgs.xdg-utils
    pkgs.gtk3
    pkgs.dbus
    pkgs.expat
    pkgs.alsa-lib
    pkgs.cairo
    pkgs.pango
    pkgs.mesa
    pkgs.xorg.libXcursor
    pkgs.xorg.libX11
    pkgs.xorg.libxcb
    pkgs.xorg.libXrandr
    pkgs.xorg.libXfixes
    pkgs.xorg.libXext
    pkgs.xorg.libXdamage
    pkgs.xorg.libXcomposite
    pkgs.libdrm
    pkgs.cups
    pkgs.at-spi2-core
    pkgs.nspr
    pkgs.nss
    pkgs.glib
  ];
}
