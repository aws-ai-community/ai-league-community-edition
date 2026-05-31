import React from "react";
import SideNavigation, {
  SideNavigationProps,
} from "@cloudscape-design/components/side-navigation";

export const navigationItems: SideNavigationProps.Item[] = [
  {
    type: "link",
    text: "Map Builder",
    href: "/map-builder",
  },
  { type: "divider" },
  {
    type: "link",
    text: "Agentic Workshop",
    href: "https://catalog.us-east-1.prod.workshops.aws/workshops/0c1f072b-ebd1-4d8d-9340-dd47479481c0/en-US/introduction",
    external: true,
  },
  {
    type: "link",
    text: "Builder Center",
    href: "https://builder.aws.com/connect/space/7e5f51ef-0919-32da-aaa7-ddf263651d69/aws-ai-league",
    external: true,
  },
  {
    type: "link",
    text: "Builder Center (Community)",
    href: "https://builder.aws.com/connect/space/7148b02a-ef8c-3a67-97c9-53be6bd54999/ai-community",
    external: true,
  },
  {
    type: "link",
    text: "AWS AI League",
    href: "https://aws.amazon.com/ai/aileague/",
    external: true,
  },
  {
    type: "link",
    text: "Official Rules",
    href: "https://aileague.aws.dev/2026-AWS-AI-League-Championship-Official-Rules.pdf",
    external: true,
  },
  {
    type: "link",
    text: "Community Blog",
    href: "https://blog.awsaicommunity.org/",
    external: true,
  },
  {
    type: "link",
    text: "Community Discord",
    href: "https://discord.com/invite/FrEUMsZrAZ",
    external: true,
  },
  {
    type: "link",
    text: "Community GitHub",
    href: "https://github.com/aws-ai-community",
    external: true,
  },
];

export default function NavigationPanel() {
  return (
    <SideNavigation
      header={{ text: "AWS AI League - Community Edition", href: "/" }}
      items={navigationItems}
    />
  );
}
