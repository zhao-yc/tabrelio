CREATE TABLE mapped_left (
  code VARCHAR(30) COLLATE utf8mb4_general_ci NOT NULL,
  seq BIGINT UNSIGNED NOT NULL,
  raw VARBINARY(32),
  conflict_token INT UNIQUE,
  local_note VARCHAR(60) DEFAULT '来源默认'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE mapped_right (
  identifier VARCHAR(30) COLLATE utf8mb4_general_ci NOT NULL,
  serial BIGINT UNSIGNED NOT NULL,
  payload VARBINARY(32),
  reserved INT UNIQUE,
  local_note VARCHAR(60) DEFAULT '目标默认'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
