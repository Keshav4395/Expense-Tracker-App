import React from 'react';
import { ArrowLeft, Download, PieChart, BarChart3 } from 'lucide-react';

const ReportsPage = ({ userData, expenses, onBack }) => {
  const totalSpent = expenses.reduce((sum, exp) => sum + parseFloat(exp.amount || 0), 0);
  const categoryBreakdown = expenses.reduce((acc, exp) => {
    acc[exp.category] = (acc[exp.category] || 0) + parseFloat(exp.amount || 0);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <button onClick={onBack} className="mb-6 text-gray-400 hover:text-white flex items-center gap-2">
        <ArrowLeft className="w-5 h-5" />
        Back to Dashboard
      </button>

      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-bold">Expense Reports</h1>
          <button className="bg-white text-black px-6 py-3 rounded-xl font-semibold flex items-center gap-2">
            <Download className="w-5 h-5" />
            Export PDF
          </button>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
              <PieChart className="w-6 h-6" />
              Category Breakdown
            </h3>
            <div className="space-y-3">
              {Object.entries(categoryBreakdown).length === 0 ? (
                <p className="text-gray-400">No expenses yet</p>
              ) : (
                Object.entries(categoryBreakdown).map(([category, amount]) => (
                  <div key={category} className="flex justify-between items-center">
                    <span className="text-gray-400">{category}</span>
                    <span className="font-bold">₹{amount.toLocaleString()}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
              <BarChart3 className="w-6 h-6" />
              Summary
            </h3>
            <div className="space-y-4">
              <div>
                <p className="text-gray-400 text-sm">Total Transactions</p>
                <p className="text-2xl font-bold">{expenses.length}</p>
              </div>
              <div>
                <p className="text-gray-400 text-sm">Total Spent</p>
                <p className="text-2xl font-bold">₹{totalSpent.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-gray-400 text-sm">Average per Transaction</p>
                <p className="text-2xl font-bold">
                  ₹{expenses.length > 0 ? (totalSpent / expenses.length).toFixed(2) : 0}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <h3 className="text-xl font-bold mb-4">All Transactions</h3>
          {expenses.length === 0 ? (
            <p className="text-center text-gray-400 py-8">No transactions to display</p>
          ) : (
            <div className="space-y-2">
              {expenses.map((expense, idx) => (
                <div key={idx} className="flex justify-between items-center p-4 bg-white/5 rounded-xl">
                  <div>
                    <p className="font-semibold">{expense.description}</p>
                    <p className="text-sm text-gray-400">{expense.category} • {expense.date}</p>
                  </div>
                  <p className="text-xl font-bold">₹{parseFloat(expense.amount).toLocaleString()}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReportsPage;
