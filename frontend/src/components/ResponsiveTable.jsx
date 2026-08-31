import React from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.jsx';

/**
 * ResponsiveTable - A table component that switches to card layout on mobile devices
 * 
 * @param {Array} columns - Array of column definitions: [{ key: string, label: string, render?: function }]
 * @param {Array} data - Array of data objects
 * @param {function} renderCard - Optional custom card renderer for mobile view
 */
export const ResponsiveTable = ({ columns, data, renderCard, className = '' }) => {
  return (
    <>
      {/* Desktop Table View */}
      <div className="hidden md:block overflow-x-auto">
        <Table className={className}>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column.key}>{column.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center text-muted-foreground">
                  No data available
                </TableCell>
              </TableRow>
            ) : (
              data.map((row, index) => (
                <TableRow key={row.id || index}>
                  {columns.map((column) => (
                    <TableCell key={column.key}>
                      {column.render ? column.render(row) : row[column.key]}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Mobile Card View */}
      <div className="md:hidden space-y-4">
        {data.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            No data available
          </div>
        ) : (
          data.map((row, index) => (
            <div
              key={row.id || index}
              className="bg-card border border-border rounded-lg p-4 space-y-2"
            >
              {renderCard ? (
                renderCard(row)
              ) : (
                columns.map((column) => (
                  <div key={column.key} className="flex justify-between items-center">
                    <span className="text-sm font-medium text-muted-foreground">
                      {column.label}
                    </span>
                    <span className="text-sm font-semibold">
                      {column.render ? column.render(row) : row[column.key]}
                    </span>
                  </div>
                ))
              )}
            </div>
          ))
        )}
      </div>
    </>
  );
};