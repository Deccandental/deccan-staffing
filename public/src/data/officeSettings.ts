export const officeSettings = {
  practiceName: "Deccan Dental",

  staffing: {
    frontDeskRequired: 2,
    hygienistsRequired: 1,
    assistantsPerDentist: 1,
  },

  officeHours: {
    monday: {
      open: "8:30 AM",
      close: "5:30 PM",
    },
    tuesday: {
      closed: true,
    },
    wednesday: {
      open: "8:30 AM",
      close: "5:30 PM",
    },
    thursday: {
      open: "8:30 AM",
      close: "5:30 PM",
    },
    friday: {
      open: "8:00 AM",
      close: "5:00 PM",
    },
  },

  defaultRoles: {
    dentists: [
      "Dr. Nanjapa",
      "Dr. Coulter",
      "Dr. Viraparia",
      "Dr. Ho",
    ],

    frontDesk: [
      "Ketki",
      "Ari",
    ],

    assistants: [
      "Karla",
      "Stephanie",
      "Unique",
    ],

    hygienists: [
      "Cindy",
    ],
  },
};